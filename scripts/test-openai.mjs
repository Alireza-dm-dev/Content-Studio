import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { PrismaClient } = require('@prisma/client');
import OpenAI from 'openai';

const prisma = new PrismaClient();

try {
  const template = await prisma.promptTemplate.findUnique({ where: { slug: 'content-calendar-generator' } });
  if (!template) { console.log('Template NOT FOUND'); process.exit(1); }
  console.log('Template OK: outputType=' + template.outputType + ', text length=' + template.templateText.length);

  const setting = await prisma.settings.findUnique({ where: { key: 'OPENAI_API_KEY' } });
  console.log('Settings key:', setting ? 'configured' : 'NOT configured');

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 30000 });
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: 'Say hello in exactly one sentence.' }],
    max_tokens: 50,
  });
  console.log('OpenAI OK:', completion.choices[0].message.content);
} catch (err) {
  console.error('FAIL:', err.message?.slice(0, 300));
  if (err.status) console.error('Status:', err.status);
  console.error('Code:', err.code);
}
await prisma.$disconnect();
