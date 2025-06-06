const { SpeechClient } = require('@google-cloud/speech');
const { TextToSpeechClient } = require('@google-cloud/text-to-speech');
const { Translate } = require('@google-cloud/translate').v2;
const { WebSocketServer } = require('ws');
const http = require('http');

const SOURCE_LANGUAGE_CODE = 'en-US';

const speechClient = new SpeechClient();
const ttsClient = new TextToSpeechClient();
const translateClient = new Translate();

const wss = new WebSocketServer({ noServer: true });

wss.on('connection', ws => {
  console.log('Client connected');
  let recognizeStream = null;

  ws.on('message', async (message) => {
    const msg = JSON.parse(message);

    switch (msg.event) {
      case 'start':
        console.log(`Starting stream for target language: ${msg.targetLanguage}`);
        if (recognizeStream) recognizeStream.end();
        recognizeStream = createRecognitionStream(ws, msg.targetLanguage);
        break;

      case 'audio':
        try {
          if (recognizeStream && !recognizeStream.destroyed) {
            recognizeStream.write(msg.data);
          } else {
            console.warn('⚠️ Tried to write to destroyed stream.');
          }
        } catch (err) {
          console.error('❌ Error writing to recognition stream:', err.message);
        }
        break;


      case 'stop':
        console.log('Stopping stream');
        if (recognizeStream) recognizeStream.end();
        recognizeStream = null;
        break;
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected');
    if (recognizeStream) recognizeStream.end();
  });
});

function createRecognitionStream(ws, targetLanguage) {
  const request = {
    config: {
      encoding: 'LINEAR16',
      sampleRateHertz: 16000,
      languageCode: SOURCE_LANGUAGE_CODE,
      enableAutomaticPunctuation: true,
      model: 'default'
    },
    interimResults: false,
  };

  const stream = speechClient
    .streamingRecognize(request)
    .on('error', (err) => {
      console.error('🛑 Recognition Error:', err.message);
      console.error(err); // mostra detalhes técnicos completos
      ws.send(JSON.stringify({ event: 'error', message: `Recognition service error: ${err.message}` }));
    })
    .on('data', async (data) => {
      if (data.results[0] && data.results[0].isFinal) {
        const transcript = data.results[0].alternatives[0].transcript;
        console.log(`🎤 Transcript: ${transcript}`);

        try {
          const translation = await translateText(transcript, targetLanguage);
          console.log(`🌐 Translation: ${translation}`);

          const sourceAudio = await synthesizeSpeech(transcript, SOURCE_LANGUAGE_CODE);
          if (sourceAudio) {
            ws.send(JSON.stringify({ event: 'audio', data: sourceAudio.toString('base64') }));
          }

          const translatedAudio = await synthesizeSpeech(translation, targetLanguage);
          if (translatedAudio) {
            setTimeout(() => {
              ws.send(JSON.stringify({ event: 'audio', data: translatedAudio.toString('base64') }));
            }, 200);
          }

        } catch (err) {
          console.error('🔥 Translation or TTS Error:', err.message);
          console.error(err); // mostra stack trace completa
          ws.send(JSON.stringify({ event: 'error', message: `Translation or TTS error: ${err.message}` }));
        }
      }
    });

  return stream;
}

async function synthesizeSpeech(text, languageCode) {
  try {
    const request = {
      input: { text },
      voice: { languageCode, ssmlGender: 'NEUTRAL' },
      audioConfig: { audioEncoding: 'MP3', sampleRateHertz: 24000 },
    };
    const [response] = await ttsClient.synthesizeSpeech(request);
    return response.audioContent;
  } catch (err) {
    console.error('TTS Error:', err);
    return null;
  }
}

async function translateText(text, targetLanguage) {
  try {
    const [translation] = await translateClient.translate(text, targetLanguage);
    return translation;
  } catch (err) {
    console.error('Translation Error:', err);
    return text;
  }
}

const server = http.createServer((req, res) => {
  res.writeHead(200);
  res.end("Translator backend is running.");
});

server.on('upgrade', (req, socket, head) => {
  if (req.headers.upgrade !== 'websocket') {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
