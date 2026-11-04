import assert from 'node:assert/strict';
import {readFileSync, readdirSync, lstatSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const [skill] = pkg.agentPackage.skills;
assert.equal(pkg.agentPackage.skills.length, 1);
assert.equal(pkg.name, '@petercjl/' + skill.name);
assert.equal(skill.path, 'skills/' + skill.name);
assert.match(readFileSync(join(skill.path, 'SKILL.md'), 'utf8'), new RegExp('^---\\nname: ' + skill.name + '\\n'));
assert.equal(JSON.parse(readFileSync(join(skill.path, 'capabilities.json'), 'utf8')).skill, skill.name);
for (const path of ['INSTALL.md', 'UPDATE.md']) assert.ok(readFileSync(path, 'utf8').includes(pkg.name));
function verifyTree(directory) {
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    const stat = lstatSync(path);
    assert.ok(stat.isFile() || stat.isDirectory(), 'Expected a physical file or directory: ' + path);
    if (stat.isDirectory()) verifyTree(path);
  }
}
verifyTree(skill.path);
const result = spawnSync(process.execPath, ['--check', join(skill.path, 'scripts', 'asset-guide.mjs')], {stdio:'inherit'});
assert.equal(result.status, 0);
