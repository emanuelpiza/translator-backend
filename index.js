const { SpeechClient } = require('@google-cloud/speech');
const { TextToSpeechClient } = require('@google-cloud/text-to-speech');
const { Translate } = require('@google-cloud/translate').v2;
const { WebSocketServer } = require('ws');
const { PassThrough } = require('stream');
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
        console.log(`🎙️ Starting stream for target language: ${msg.targetLanguage}`);
        if (recognizeStream) {
          recognizeStream.destroy();
          recognizeStream = null;
        }
        recognizeStream = createRecognitionStream(ws, msg.targetLanguage);
        break;

      case 'audio':
        try {
          if (recognizeStream && !recognizeStream.destroyed && msg.data) {
            recognizeStream.write(Buffer.from(msg.data, 'base64'));
          } else {
            console.warn('⚠️ Tried to write to a destroyed or nonexistent stream.');
          }
        } catch (err) {
          console.error('❌ Error writing to recognition stream:', err.message);
        }
        break;

      case 'stop':
        console.log('🛑 Stopping stream');
        if (recognizeStream && !recognizeStream.destroyed) {
          try {
            recognizeStream.end();
            recognizeStream.destroy();
          } catch (err) {
            console.warn('⚠️ Error during stream stop:', err.message);
          }
        }
        recognizeStream = null;
        break;
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected');
    if (recognizeStream && !recognizeStream.destroyed) {
      try {
        recognizeStream.end();
        recognizeStream.destroy();
      } catch (err) {
        console.warn('⚠️ Error during stream close:', err.message);
      }
    }
  });
});

// 🧠 Helper: limpa o código do idioma
function normalizeLangCode(lang) {
  return lang.split('-')[0];
}

// 🧠 Helper: mapeia para código aceito pelo TTS
function getTTSVoiceCode(lang) {
  const map = {
    'vi': 'vi-VN',
    'es': 'es-ES',
    'fr': 'fr-FR',
    'ja': 'ja-JP',
    'ko': 'ko-KR',
    'de': 'de-DE',
  };
  return map[normalizeLangCode(lang)] || 'en-US';
}

function createRecognitionStream(ws, targetLanguage) {
  const audioStream = new PassThrough();

  const request = {
    config: {
      encoding: 'LINEAR16',
      sampleRateHertz: 16000,
      languageCode: SOURCE_LANGUAGE_CODE,
      enableAutomaticPunctuation: true,
      model: 'default',
    },
    interimResults: false,
  };

  const stream = speechClient
    .streamingRecognize(request)
    .on('error', (err) => {
      console.error('🛑 Recognition Error:', err.message);
      ws.send(JSON.stringify({ event: 'error', message: `Recognition error: ${err.message}` }));
    })
    .on('data', async (data) => {
      if (data.results[0]?.isFinal) {
        const transcript = data.results[0].alternatives[0].transcript;
        console.log(`🎤 Transcript: ${transcript}`);

        try {
          const translation = await translateText(transcript, targetLanguage);
          console.log(`🌐 Translation: ${translation}`);

          const translatedAudio = await synthesizeSpeech(translation, targetLanguage);
          if (translatedAudio) {
            ws.send(JSON.stringify({ event: 'audio', data: translatedAudio.toString('base64') }));
          }
        } catch (err) {
          console.error('🔥 Translation or TTS Error:', err.message);
        }
      }
    });

  audioStream.pipe(stream);
  return audioStream;
}

async function synthesizeSpeech(text, languageCode) {
  try {
    const ttsLang = getTTSVoiceCode(languageCode);
    const request = {
      input: { text },
      voice: { languageCode: ttsLang, ssmlGender: 'NEUTRAL' },
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
  const cleanLang = normalizeLangCode(targetLanguage);
  console.log('🧠 Translating:', text, '=>', cleanLang);
  try {
    const [translation] = await translateClient.translate(text, cleanLang);
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
console.log('🚀 About to start server...');
server.listen(PORT, () => {
  console.log(`✅ Server listening on port ${PORT}`);
});

