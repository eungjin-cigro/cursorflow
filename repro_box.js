
const { stripAnsi } = require('./src/utils/enhanced-logger');

const COLORS = {
  reset: '\x1b[0m',
  gray: '\x1b[90m',
  cyan: '\x1b[36m',
};

const types = [
  { type: 'user', prefix: `${COLORS.cyan}🧑 USER${COLORS.reset}` },
  { type: 'system', prefix: `${COLORS.gray}⚙️ SYS${COLORS.reset}` },
  { type: 'thinking', prefix: `${COLORS.gray}🤔 THNK${COLORS.reset}` },
  { type: 'info', prefix: `${COLORS.cyan}ℹ️ INFO${COLORS.reset}` },
  { type: 'done', prefix: `${COLORS.green}✅ DONE${COLORS.reset}` },
  { type: 'err', prefix: `${COLORS.red}❌ ERR${COLORS.reset}` }
];

for (const t of types) {
  const stripped = stripAnsi(t.prefix);
  const len = stripped.length;
  // Count only emojis that are length 1 but width 2
  // For simplicity, let's see which ones are length 1
  console.log(`Type: ${t.type}, Stripped: "${stripped}", Len: ${len}`);
}

