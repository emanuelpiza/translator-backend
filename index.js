const { SpeechClient } = require('@google-cloud/speech');
const { TextToSpeechClient } = require('@google-cloud/text-to-speech');
const { WebSocketServer } = require('ws');

// --- CONFIGURATION ---
// You can adjust the source language if you want to fix it,
// otherwise 'en-US' is a good default for auto-detection to branch from.
const SOURCE_LANGUAGE_CODE = 'en-US';

// Instantiate clients
const speechClient = new SpeechClient();
const ttsClient = new TextToSpeechClient();
const wss = new WebSocketServer({ noServer: true });

// --- WebSocket Connection Handling ---
wss.on('connection', ws => {
  console.log('Client connected');
  let recognizeStream = null;

  ws.on('message', async (message) => {
    const msg = JSON.parse(message);

    switch (msg.event) {
      case 'start':
        console.log(`Starting stream for target language: ${msg.targetLanguage}`);
        if (recognizeStream) {
          recognizeStream.end();
        }
        recognizeStream = createRecognitionStream(ws, msg.targetLanguage);
        break;
      case 'audio':
        if (recognizeStream) {
          recognizeStream.write(msg.data);
        }
        break;
      case 'stop':
        console.log('Stopping stream');
        if (recognizeStream) {
          recognizeStream.end();
        }
        recognizeStream = null;
        break;
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected');
    if (recognizeStream) {
      recognizeStream.end();
    }
  });
});

// --- Core Speech Recognition and Translation Stream ---
function createRecognitionStream(ws, targetLanguage) {
  const request = {
    config: {
      encoding: 'LINEAR16',
      sampleRateHertz: 16000,
      languageCode: SOURCE_LANGUAGE_CODE,
      enableAutomaticPunctuation: true,
      model: 'long',
      // This is the magic for translation
      translationConfig: {
        targetLanguageCodes: [targetLanguage],
        model: "nmt/global" // NMT (Neural Machine Translation) is a robust model
      },
    },
    interimResults: false,
  };

  const stream = speechClient
    .streamingRecognize(request)
    .on('error', (err) => {
       console.error('Recognition Error:', err);
       ws.send(JSON.stringify({ event: 'error', message: 'Recognition service error.' }));
    })
    .on('data', async (data) => {
      // We only process final results to avoid choppy audio
      if (data.results[0] && data.results[0].isFinal) {
        const transcript = data.results[0].alternatives[0].transcript;
        const translation = data.results[0].translation;
        console.log(`Transcript: ${transcript}`);
        console.log(`Translation: ${translation}`);

        // 1. Synthesize the original transcript to audio
        const sourceAudio = await synthesizeSpeech(transcript, SOURCE_LANGUAGE_CODE);
        if (sourceAudio) {
          ws.send(JSON.stringify({ event: 'audio', data: sourceAudio.toString('base64') }));
        }

        // 2. Synthesize the translated text to audio
        const translatedAudio = await synthesizeSpeech(translation, targetLanguage);
        if (translatedAudio) {
            // Give a tiny delay for separation
            setTimeout(() => {
               ws.send(JSON.stringify({ event: 'audio', data: translatedAudio.toString('base64') }));
            }, 200);
        }
      }
    });

  return stream;
}

// --- Text-to-Speech Helper Function ---
async function synthesizeSpeech(text, languageCode) {
  try {
    const request = {
      input: { text: text },
      voice: { languageCode: languageCode, ssmlGender: 'NEUTRAL' },
      audioConfig: { audioEncoding: 'MP3', sampleRateHertz: 24000 },
    };
    const [response] = await ttsClient.synthesizeSpeech(request);
    return response.audioContent;
  } catch (err) {
    console.error('TTS Error:', err);
    return null;
  }
}

// --- Expose as a Google Cloud Function ---
// This part makes it work as a Cloud Function that can handle WebSocket upgrades.
exports.realtimeTranslator = (req, res) => {
  if (req.headers.upgrade !== 'websocket') {
    res.status(400).send('Expected WebSocket request');
    return;
  }
  wss.handleUpgrade(req, req.socket, Buffer.alloc(0), ws => {
    wss.emit('connection', ws, req);
  });
};
