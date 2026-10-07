'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

// Keep each downloadable plugin usable without the rest of the repository.
function syncPlugins({ check = false } = {}) {
  const copies = [];
  for (const provider of ['claude', 'openai']) {
    const target = `plugins/${provider}-session-pets`;
    copies.push(['scripts/pet.py', `${target}/skills/Session-Pets/scripts/pet.py`]);
    copies.push(['LICENSE', `${target}/LICENSE`]);
    copies.push(['assets/session-pets-icon.png', `${target}/assets/icon.png`]);
  }
  for (const file of ['SKILL.md', 'agents/openai.yaml']) {
    copies.push([`integrations/codex/Session-Pets/${file}`, `plugins/openai-session-pets/skills/Session-Pets/${file}`]);
  }
  for (const [source, target] of copies) {
    const input = fs.readFileSync(path.join(root, source));
    const output = path.join(root, target);
    if (check) {
      if (!fs.existsSync(output) || !input.equals(fs.readFileSync(output))) {
        throw Error(`Plugin copy is out of date: ${target}. Run npm run sync:plugins.`);
      }
    } else {
      fs.mkdirSync(path.dirname(output), { recursive: true });
      fs.writeFileSync(output, input);
    }
  }
  const { version } = require('../package.json');
  for (const file of ['plugins/claude-session-pets/.claude-plugin/plugin.json', 'plugins/openai-session-pets/plugin.json']) {
    if (JSON.parse(fs.readFileSync(path.join(root, file))).version !== version) {
      throw Error(`Plugin version must match ${version}: ${file}`);
    }
  }
}

if (require.main === module) {
  syncPlugins({ check: process.argv.includes('--check') });
  console.log('Plugin source copies and versions are consistent.');
}
module.exports = { syncPlugins };
