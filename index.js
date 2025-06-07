
const { SpeechClient } = require('@google-cloud/speech');
const { TextToSpeechClient } = require('@google-cloud/text-to-speech');
const { Translate } = require('@google-cloud/translate').v2;
const { WebSocketServer } = require('ws');
const http = require('http');

// Certifique-se de que as suas credenciais do Google Cloud estão configuradas
// no ambiente (variável de ambiente GOOGLE_APPLICATION_CREDENTIALS)
const speechClient = new SpeechClient();
const ttsClient = new TextToSpeechClient();
const translateClient = new Translate();

const wss = new WebSocketServer({ noServer: true });

wss.on('connection', ws => {
  console.log('Client on');
  
  ws.on('message', async message => {
    try {
        const msg = JSON.parse(message);

        // Processa apenas mensagens de evento de 'áudio'
        if (msg.event === 'audio' && msg.audioData && msg.targetLang) {
            const { audioData, targetLang } = msg;

            // Define os idiomas de origem e destino
            const sourceLang = targetLang === 'en' ? 'vi-VN' : 'en-US';
            console.log(`Translating from ${sourceLang} to ${targetLang}`);

            // 1. Transcrever áudio com a Google Speech-to-Text
            const [response] = await speechClient.recognize({
                config: {
                    encoding: 'WEBM_OPUS',
                    sampleRateHertz: 48000, // O webm gravado no browser geralmente tem esta taxa
                    languageCode: sourceLang,
                },
                audio: {
                    content: audioData,
                },
            });

            const transcript = response.results?.[0]?.alternatives?.[0]?.transcript || '';
            if (!transcript) {
                throw new Error('Audio could not be transcribed.');
            }
            console.log(`🗣️ Transcrição (${sourceLang}):`, transcript);

            // 2. Traduzir texto com a Google Translate
            const [translated] = await translateClient.translate(transcript, targetLang);
            console.log(`✅ Traduzido (${targetLang}):`, translated);
            
            // 3. Sintetizar voz com a Google Text-to-Speech
            const voiceConfig = targetLang === 'vi' 
                ? { languageCode: 'vi-VN', name: 'vi-VN-Wavenet-D' } // Voz masculina para vietnamita
                : { languageCode: 'en-US', name: 'en-US-Wavenet-D' }; // Voz masculina para inglês
            
            const [ttsRes] = await ttsClient.synthesizeSpeech({
                input: { text: translated },
                voice: voiceConfig,
                audioConfig: { audioEncoding: 'MP3' },
            });
            
            // 4. Enviar o áudio de volta para o cliente
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

  ws.on('close', () => {
    console.log('Client off');
  });
});

// Servidor HTTP padrão para lidar com upgrades de WebSocket
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
  console.log(`✅ Server listening port ${PORT}`);
});
