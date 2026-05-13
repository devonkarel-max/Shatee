import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import { v2 as cloudinary } from 'cloudinary';
import { GoogleGenAI } from "@google/genai";
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Cloudinary config
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

const getAI = (req: express.Request) => {
  const userKey = req.headers['x-gemini-key'];
  if (userKey && typeof userKey === 'string' && userKey.trim() !== '') {
    return new GoogleGenAI({ apiKey: userKey });
  }
  return ai;
};

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '10mb' }));

  // API Routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Get Cloudinary Signature for signed uploads
  app.get("/api/cloudinary-signature", (req, res) => {
    const timestamp = Math.round((new Date()).getTime() / 1000);
    const signature = cloudinary.utils.api_sign_request({
      timestamp: timestamp,
      folder: 'tasks'
    }, process.env.CLOUDINARY_API_SECRET || '');

    res.json({
      signature,
      timestamp,
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY
    });
  });

  // Generate Audio Comment with Gemini TTS
  app.post("/api/generate-audio", async (req, res) => {
    try {
      const { text } = req.body;
      if (!text) return res.status(400).json({ error: "Missing text" });

      const client = getAI(req);
      const result = await client.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [{ role: 'user', parts: [{ text: `Speak in a deep and calm voice as Shate assistant: ${text}` }] }],
        config: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: "Charon" },
            },
          },
        } as never, // eslint-disable-line @typescript-eslint/no-explicit-any
      });

      const audioPart = result.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
      const base64Audio = audioPart?.inlineData?.data;
      
      if (!base64Audio) throw new Error("No audio generated in response");

      res.json({ audioData: base64Audio });
    } catch {
      res.status(500).json({ error: "Failed to generate audio" });
    }
  });

  // Analyze proof with Gemini
  app.post("/api/analyze-proof", async (req, res) => {
    try {
      const { imageUrl, taskText } = req.body;
      if (!imageUrl || !taskText) {
        return res.status(400).json({ error: "Missing image/task context" });
      }

      // We fetch image from Cloudinary
      const imageResp = await fetch(imageUrl);
      const buffer = await imageResp.arrayBuffer();
      const base64 = Buffer.from(buffer).toString('base64');

      const prompt = `The user just submitted a photo as proof of completing the task: "${taskText}". 
      Analyze the photo and evaluate if it truly proves task completion. 
      If yes, praise the user and give encouraging feedback (max 2 sentences). 
      If no, politely explain what is missing. 
      Respond in English, concisely and with empathy as Shate assistant.`;

      const model = "gemini-3-flash-preview";
      const client = getAI(req);
      const result = await client.models.generateContent({
        model,
        contents: [{
          role: 'user',
          parts: [
            { text: prompt },
            {
              inlineData: {
                mimeType: "image/jpeg",
                data: base64
              }
            }
          ]
        }]
      });

      res.json({ feedback: result.text });
    } catch {
      res.status(500).json({ error: "Failed to analyze proof" });
    }
  });

  // Chat with Gemini
  app.post("/api/chat", async (req, res) => {
    try {
      const { messages, systemInstruction, tools } = req.body;
      if (!messages) return res.status(400).json({ error: "Missing messages" });

      const client = getAI(req);
      const result = await (client.models.generateContent as any)({ // eslint-disable-line @typescript-eslint/no-explicit-any
        model: "gemini-3-flash-preview",
        systemInstruction: systemInstruction,
        tools: tools,
        contents: messages
      });

      res.json({ 
        text: result.text,
        functionCalls: result.functionCalls
      });
    } catch (error) {
      console.error("Gemini Chat Error:", error);
      res.status(500).json({ error: "Failed to process chat" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    // Set caching headers for static assets
    app.use(express.static(distPath, {
      maxAge: '1d',
      setHeaders: (res, path) => {
        if (path.endsWith('index.html')) {
          res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
          res.setHeader('Pragma', 'no-cache');
          res.setHeader('Expires', '0');
        }
      }
    }));
    
    app.get('*', (req, res) => {
      // Don't serve index.html for missing assets or API routes
      if (req.path.startsWith('/api') || req.path.includes('.')) {
        return res.status(404).send('Not Found');
      }
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
