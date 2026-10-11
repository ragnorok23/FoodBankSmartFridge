import { createApp } from './app.js';
const port = Number(process.env.PORT || 3100);
createApp().listen(port, '127.0.0.1', () => {
  console.log(`Fridge vision test: http://localhost:${port}`);
  console.log(`Gemini key: ${process.env.GEMINI_API_KEY?.trim() ? 'configured' : 'not set yet'}`);
});
