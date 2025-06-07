// index.js

const { WebSocketServer } = require('ws');
const http = require('http');
const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// Ensure you have OPENAI_API_KEY in your .env file or environment variables
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const wss = new WebSocketServer({ noServer: true });

// Create a temp directory for audio files if it doesn't exist
const tempDir = path.join(__dirname, 'temp');
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir);
}

wss.on('connection', ws => {
  console.log('Client connected');

  // When a message is received (in this case, the audio blob)
  ws.on('message', async message => {
    const tempFilePath = path.join(tempDir, `${uuidv4()}.webm`);
    
    try {
      // 1. Save the received audio blob to a temporary file
      fs.writeFileSync(tempFilePath, message);

      // 2. Transcribe audio using OpenAI Whisper API
      console.log(`Transcribing audio: ${tempFilePath}`);
      const transcription = await openai.audio.transcriptions.create({
        file: fs.createReadStream(tempFilePath),
        model: 'whisper-1',
        language: 'en', // Providing hints can improve accuracy
        prompt: "This is a conversation between a Vietnamese and an English speaker." // Prompt can guide the model
      });
      const transcript = transcription.text;
      console.log('🗣️ Transcript:', transcript);

      // 3. Detect language and translate using GPT
      console.log('Translating text...');
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini", // A fast and capable model
        messages: [
          {
            role: "system",
            content: "You are a language detection and translation expert. First, detect if the following text is primarily 'Vietnamese' or 'English'. Then, translate it to the other language. Your response must be only the translated text, with no explanations or extra phrases."
          },
          {
            role: "user",
            content: transcript
          }
        ],
        temperature: 0, // For deterministic translation
      });

      const translated = completion.choices[0].message.content.trim();
      const targetLang = (translated.match(/[\u0041-\u005A\u0061-\u007A]/)) ? 'en-US' : 'vi-VN';
      console.log(`✅ Translated (${targetLang}):`, translated);

      // 4. Synthesize speech using OpenAI TTS API
      console.log('Synthesizing audio...');
      const ttsResponse = await openai.audio.speech.create({
        model: "tts-1",
        voice: targetLang === 'vi-VN' ? "alloy" : "nova", // Choose voices
        input: translated,
        response_format: "mp3",
      });
      
      // 5. Stream the audio back to the client
      const audioBuffer = Buffer.from(await ttsResponse.arrayBuffer());
      ws.send(JSON.stringify({
        event: 'audio',
        data: audioBuffer.toString('base64')
      }));

    } catch (err) {
      console.error('⚠️ Error processing audio:', err);
      // Let the client know something went wrong
      ws.send(JSON.stringify({
        event: 'error',
        message: err.message || 'Failed to process audio.'
      }));
    } finally {
      // 6. Clean up the temporary file
      if (fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
        console.log(`Cleaned up: ${tempFilePath}`);
      }
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected');
  });
});

// Standard HTTP server setup to handle WebSocket upgrades
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Translator backend with OpenAI is running');
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
