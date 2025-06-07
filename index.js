const { SpeechClient } = require('@google-cloud/speech');
const { TextToSpeechClient } = require('@google-cloud/text-to-speech');
const { Translate } = require('@google-cloud/translate').v2;
const { WebSocketServer } = require('ws');
const { PassThrough } = require('stream');
const http = require('http');

const speechClient = new SpeechClient();
const ttsClient = new TextToSpeechClient();
const translateClient = new Translate();

const wss = new WebSocketServer({ noServer: true });

wss.on('connection', ws => {
  console.log('Client connected');

  let buffers = [];

  ws.on('message', async message => {
    const msg = JSON.parse(message);

    if (msg.event === 'start-auto') {
      buffers = [];
    }

    if (msg.event === 'audio') {
      buffers.push(Buffer.from(msg.data, 'base64'));
    }

    if (msg.event === 'stop') {
      const fullAudio = Buffer.concat(buffers);

      try {
        const [response] = await speechClient.recognize({
          config: {
            encoding: 'WEBM_OPUS',
            sampleRateHertz: 48000,
            languageCode: 'en-US',
            alternativeLanguageCodes: ['vi-VN'],
            enableAutomaticPunctuation: true,
          },
          audio: {
            content: fullAudio.toString('base64'),
          },
        });

        const transcript = response.results?.[0]?.alternatives?.[0]?.transcript || '';
        console.log(`🗣 Transcribed: ${transcript}`);

        // Detect language using Translate API
        const [detection] = await translateClient.detect(transcript);
        const detectedLang = detection.language || 'en';
        console.log(`🔍 Detected Language: ${detectedLang}`);

        // Define target language
        const targetLang = detectedLang.startsWith('vi') ? 'en' : 'vi';
        const ttsLangCode = targetLang === 'vi' ? 'vi-VN' : 'en-US';

        const [translated] = await translateClient.translate(transcript, targetLang);
        console.log(`🌐 Translated: ${translated}`);

        const [ttsRes] = await ttsClient.synthesizeSpeech({
          input: { text: translated },
          voice: { languageCode: ttsLangCode, ssmlGender: 'NEUTRAL' },
          audioConfig: { audioEncoding: 'MP3' }
        });

        ws.send(JSON.stringify({ event: 'audio', data: ttsRes.audioContent.toString('base64') }));
      } catch (err) {
        console.error('⚠️ Error:', err);
        ws.send(JSON.stringify({ event: 'error', message: err.message }));
      }
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected');
  });
});

const server = http.createServer((req, res) => {
  res.writeHead(200);
  res.end('Translator backend is running');
});

server.on('upgrade', (req, socket, head) => {
  if (req.headers.upgrade !== 'websocket') {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, ws => {
    wss.emit('connection', ws, req);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`✅ Server listening on port ${PORT}`);
});
