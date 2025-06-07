const { SpeechClient } = require('@google-cloud/speech');
const { TextToSpeechClient } = require('@google-cloud/text-to-speech');
const { Translate } = require('@google-cloud/translate').v2;
const { WebSocketServer } = require('ws');
const http = require('http');

// Google Cloud clients
const speechClient = new SpeechClient();
const ttsClient = new TextToSpeechClient();
const translateClient = new Translate();

const wss = new WebSocketServer({ noServer: true });

// 🔹 Filler word remover
const fillerWords = [
  "uh", "um", "like", "you know", "so", "actually",
  "basically", "right", "i mean", "well", "okay", "sort of"
];

function cleanTranscript(text) {
  const pattern = new RegExp(`\\b(${fillerWords.join("|")})\\b`, "gi");
  return text.replace(pattern, "").replace(/\s{2,}/g, " ").trim();
}

wss.on('connection', ws => {
  console.log('Client on');
  
  ws.on('message', async message => {
    try {
        const msg = JSON.parse(message);

        if (msg.event === 'audio' && msg.audioData && msg.targetLang) {
            const { audioData, targetLang } = msg;

            const sourceLang = targetLang === 'en' ? 'vi-VN' : 'en-US';
            console.log(`🌍 Translating from ${sourceLang} to ${targetLang}`);

            // 1. Transcrição
            const [response] = await speechClient.recognize({
                config: {
                    encoding: 'WEBM_OPUS',
                    sampleRateHertz: 48000,
                    languageCode: sourceLang,
                    audioChannelCount: 2
                },
                audio: { content: audioData },
            });

            const rawTranscript = response.results?.[0]?.alternatives?.[0]?.transcript || '';
            if (!rawTranscript) throw new Error('Audio could not be transcribed.');
            
            const cleanedTranscript = cleanTranscript(rawTranscript);
            console.log(`🗣️ Transcrição (raw):`, rawTranscript);
            console.log(`🧹 Transcrição (clean):`, cleanedTranscript);

            // 2. Tradução
            const [translated] = await translateClient.translate(cleanedTranscript, targetLang);
            console.log(`✅ Traduzido (${targetLang}):`, translated);
            
            // 3. Síntese de voz
            const voiceConfig = targetLang === 'vi' 
                ? { languageCode: 'vi-VN', name: 'vi-VN-Wavenet-D' }
                : { languageCode: 'en-US', name: 'en-US-Wavenet-D' };
            
            const [ttsRes] = await ttsClient.synthesizeSpeech({
                input: { text: translated },
                voice: voiceConfig,
                audioConfig: { audioEncoding: 'MP3' },
            });
            
            // 4. Resposta ao cliente
            ws.send(JSON.stringify({ 
                event: 'audio', 
                data: ttsRes.audioContent.toString('base64') 
            }));
        }
    } catch (err) {
      console.error('⚠️ Erro:', err);
      ws.send(JSON.stringify({ event: 'error', message: err.message || 'Server error.' }));
    }
  });

  ws.on('close', () => console.log('Client off'));
});

// Servidor HTTP padrão
const server = http.createServer((req, res) => {
  res.writeHead(200, {'Content-Type': 'text/plain'});
  res.end('Translator Backend with Google API is working.');
});

server.on('upgrade', (req, socket, head) => {
  wss.handleUpgrade(req, socket, head, ws => {
    wss.emit('connection', ws, req);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`✅ Server listening on port ${PORT}`);
});
