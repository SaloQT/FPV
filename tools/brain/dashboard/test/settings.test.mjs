import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import { TRAINING_FIELDS, TRAINING_STYLES, trainingDefaults, validateTrainingConfig } from '../js/trainingSettings.js';
import { DEFAULT_TEMPLATE, RUN_FIELDS, TEMPLATES, TEMPLATE_BRAINS, TEMPLATE_GOALS, templateById, templateChanges, templateSettings, formatSetting, normaliseParks, parkItem, parsePark, COASTER_NAMES, PARK_COASTERS, PARK_SIZES } from '../js/templates.js';

test('every PPO and environment configuration field has a dashboard control, with matching trainer defaults', async () => {
  for (const [scope,file,constant,type] of [
    ['ppo','../../../../src/ai/train/ppo.ts','DEFAULT_PPO','PpoConfig'],
    ['env','../../../../src/ai/gpu/envKernel.ts','DEFAULT_ENV','EnvConfig'],
  ]) {
    const source=await readFile(new URL(file,import.meta.url),'utf8');
    const block=source.match(new RegExp(`export interface ${type} \\{([\\s\\S]*?)\\n\\}`))[1];
    const keys=[...block.matchAll(/^\s*(\w+)\??:/gm)].map(m=>m[1]);
    const fields=TRAINING_FIELDS.filter(f=>f.scope===scope);
    assert.deepEqual(fields.map(f=>f.key).sort(),keys.sort());
    const defaults=runInNewContext('('+source.match(new RegExp(`export const ${constant}[^=]*= (\\{[\\s\\S]*?\\n\\});`))[1]+')');
    for(const [key,value] of Object.entries(defaults)) {
      if(key==='traceEnvs')continue; // The manager intentionally enables the existing dashboard trace default.
      assert.equal(JSON.stringify(trainingDefaults()[scope][key]),JSON.stringify(value),`${scope}.${key}`);
    }
  }
});

test('configuration validation accepts custom rewards, batch sizes and optimizer settings and rejects inconsistent settings', () => {
  const custom=validateTrainingConfig({envs:1024,steps:16,minibatches:4,chunk:256,hidden:[64,32],lr:.001,adamBeta1:.8,traceEnvs:32}, {gateReward:20,crashPenalty:50,progressReward:-.5});
  assert.equal(custom.ppo.lrEnd,.001); assert.equal(custom.env.gateReward,20); assert.deepEqual(custom.ppo.hidden,[64,32]);
  assert.throws(()=>validateTrainingConfig({epochs:0}),/PPO epochs/);
  assert.throws(()=>validateTrainingConfig({minibatches:7}),/minibatch/);
  assert.throws(()=>validateTrainingConfig({traceEnvs:17}),/Traced drones/);
  assert.throws(()=>validateTrainingConfig({adamBeta1:1}),/Adam beta/);
  assert.throws(()=>validateTrainingConfig({profile:'true'}),/on or off/);
  assert.throws(()=>validateTrainingConfig({hidden:[0,32]}),/hidden layers/);
  assert.throws(()=>validateTrainingConfig({logStdMin:1,logStdMax:0}),/action spread/);
  assert.throws(()=>validateTrainingConfig({}, {tempMin:40,tempMax:20}),/temperature/);
  assert.throws(()=>validateTrainingConfig({}, {progressReward:null}),/Progress reward/);
  assert.throws(()=>validateTrainingConfig({}, {gateReword:10}),/Unknown env/);
});

test('every template uses known settings, passes the trainer validation and keeps its run settings in range', () => {
  const keys={ppo:new Set(TRAINING_FIELDS.filter(f=>f.scope==='ppo').map(f=>f.key)),env:new Set(TRAINING_FIELDS.filter(f=>f.scope==='env').map(f=>f.key))};
  const runKeys=new Set(RUN_FIELDS.map(f=>f.key));
  assert.equal(new Set(TEMPLATES.map(t=>t.id)).size,TEMPLATES.length,'template ids are unique');
  assert.ok(templateById(DEFAULT_TEMPLATE));
  for(const t of TEMPLATES) {
    assert.ok(t.name&&t.summary&&t.notes.length,`${t.id} describes itself`);
    assert.ok(Object.hasOwn(TEMPLATE_GOALS,t.goal)&&Object.hasOwn(TEMPLATE_BRAINS,t.brain),`${t.id} goal and brain`);
    for(const key of Object.keys(t.run)) assert.ok(runKeys.has(key),`${t.id} run.${key}`);
    for(const scope of ['ppo','env']) for(const key of Object.keys(t[scope])) assert.ok(keys[scope].has(key),`${t.id} ${scope}.${key}`);
    const s=templateSettings(t.id);
    const checked=validateTrainingConfig(s.ppo,s.env);
    assert.ok(checked.ppo.logStdMin<=checked.ppo.logStdMax,`${t.id} action spread`);
    assert.ok(s.minutes>=.1&&s.minutes<=1440&&s.every>=.01&&s.every<=1440,`${t.id} duration`);
    assert.ok(Number.isInteger(s.worlds)&&s.worlds>=1&&s.worlds<=192,`${t.id} worlds`);
    assert.ok(s.recipes===null||(Number.isInteger(s.recipes)&&s.recipes>=0&&s.recipes<=s.worlds),`${t.id} recipes`);
    assert.ok(s.styles.length&&s.styles.every(x=>TRAINING_STYLES.includes(x)),`${t.id} styles`);
    assert.equal(normaliseParks(s.parks),s.parks,`${t.id} parks`);
    if(t.ppo.lr!==undefined) assert.ok(s.ppo.lrEnd<=s.ppo.lr,`${t.id} learning rate falls or holds`);
    assert.equal(templateChanges(t.id).length>0,t.id!==DEFAULT_TEMPLATE,`${t.id} changes`);
  }
});

test('template settings layer the overrides on the defaults, and the notes match the numbers they describe', () => {
  const d=trainingDefaults();
  const smooth=templateSettings('smooth-lines');
  const near=(a,b)=>Math.abs(a-b)<=1e-9*Math.abs(b);
  assert.ok(near(smooth.env.ratePenalty,3*d.env.ratePenalty)&&near(smooth.env.smoothPenalty,4*d.env.smoothPenalty),'triples and quadruples');
  assert.equal(smooth.env.gateReward,d.env.gateReward); assert.equal(smooth.worlds,48);
  const race=templateSettings('race-pace');
  assert.ok(race.env.ratePenalty>d.env.ratePenalty&&race.env.smoothPenalty>d.env.smoothPenalty);
  const attack=templateSettings('lap-attack');
  assert.ok(attack.env.ratePenalty<d.env.ratePenalty&&attack.env.smoothPenalty<d.env.smoothPenalty&&attack.env.progressReward>d.env.progressReward);
  assert.equal(templateSettings('quick-check').ppo.lrEnd,d.ppo.lrEnd);
  const changes=templateChanges('first-laps');
  assert.deepEqual(changes.find(c=>c.key==='gateReward'),{scope:'env',key:'gateReward',label:TRAINING_FIELDS.find(f=>f.key==='gateReward').label,from:d.env.gateReward,to:8});
  assert.ok(changes.some(c=>c.scope==='run'&&c.key==='styles'));
  // Editing a template's settings never changes the template itself.
  templateSettings('first-laps').styles.push('acro');
  assert.ok(!templateSettings('first-laps').styles.includes('acro'));
  assert.throws(()=>templateSettings('missing'),/Unknown template/);
  assert.deepEqual(templateChanges('missing'),[]);
  assert.equal(formatSetting(null),'Automatic'); assert.equal(formatSetting(1e-4),'1e-4'); assert.equal(formatSetting(3e-4),'3e-4');
  assert.equal(formatSetting(0.1+0.2),'0.3'); assert.equal(formatSetting(['race','acro']),'race, acro'); assert.equal(formatSetting(true),'On');
});

test('theme park lists come out as train.mjs --parks takes them, and anything else is refused', () => {
  assert.equal(normaliseParks(' 1337, 7:compact ,31415:mega'),'1337,7:compact,31415:mega');
  assert.equal(normaliseParks(''),''); assert.equal(normaliseParks(null),'');
  assert.equal(normaliseParks('7:destination:race, 7:compact:coaster2, 31415:mega:tour, 1337:destination:coaster6'),'7,7:compact:coaster2,31415:mega:tour,1337:destination:coaster6');
  const bads=['7:huge','x','7:compact:2','-3','1.5','7:compact:coaster3','7:mega:coaster10','7:compact:tour:x','7:coaster0','7,7:destination:race',Array.from({length:9},(_,i)=>i).join(',')];
  for(const bad of bads) assert.equal(normaliseParks(bad),null,bad);
  assert.deepEqual(parsePark('31415:mega:coaster9'),{seed:31415,size:'mega',route:9});
  for(const p of [{seed:0,size:'destination',route:'race'},{seed:7,size:'compact',route:2},{seed:9,size:'mega',route:'tour'}]) assert.deepEqual(parsePark(parkItem(p)),p);
  assert.equal(formatSetting(''),'None');
});

test("the park picker has the game's park sizes, coaster counts and coaster names", async () => {
  const recipe=await readFile(new URL('../../../../src/world/park/recipe.ts',import.meta.url),'utf8');
  const menu=await readFile(new URL('../../../../src/ui/menuPark.ts',import.meta.url),'utf8');
  for(const size of PARK_SIZES) assert.equal(Number(new RegExp(size+String.raw`: \{ coasters: (\d+)`).exec(recipe)?.[1]),PARK_COASTERS[size],size);
  assert.equal(COASTER_NAMES.length,Math.max(...Object.values(PARK_COASTERS)));
  assert.ok(menu.includes(JSON.stringify(COASTER_NAMES).replaceAll('"',"'").replaceAll(',',', ')),'coaster names match src/ui/menuPark.ts');
});
