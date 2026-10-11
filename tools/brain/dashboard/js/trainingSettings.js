// Shared by the form, launcher and CLI. Defaults are checked against the trainer in settings.test.mjs.
const number = (scope, key, label, value, min, max, help, group, integer = false) => ({ scope, key, label, default: value, min, max, help, group, type: 'number', integer });
export const TRAINING_FIELDS = [
  number('ppo','envs','Parallel environments',16384,128,32768,'Must be a multiple of 128. Larger batches use more GPU memory.','Batch and network',true),
  number('ppo','steps','Rollout steps',32,1,1024,'Policy steps collected before each PPO update.','Batch and network',true),
  number('ppo','epochs','PPO epochs',4,1,100,'Passes through each rollout.','Batch and network',true),
  number('ppo','minibatches','Minibatches',8,1,1024,'Each minibatch must fit the gradient chunk and contain a multiple of 256 samples.','Batch and network',true),
  {scope:'ppo',key:'hidden',label:'Hidden layer widths',default:[128,128],type:'layers',help:'Comma-separated widths, e.g. 128,128. A continued brain keeps its own architecture.',group:'Batch and network'},
  number('ppo','chunk','Gradient chunk rows',1024,16,65536,'Multiple of 16; must divide the minibatch size.','Batch and network',true),
  number('ppo','seed','Seed',1,0,2147483647,'Seed for worlds, initial weights and permutations.','Batch and network',true),
  number('ppo','gamma','Discount factor (gamma)',.995,0,1,'How much future reward matters.','PPO learning'),
  number('ppo','lambda','GAE lambda',.95,0,1,'Advantage estimate smoothing.','PPO learning'),
  number('ppo','clip','PPO clipping',.2,0,10,'Policy probability-ratio clipping range.','PPO learning'),
  number('ppo','vfCoef','Value loss weight',.5,0,1e6,'Weight of the critic loss.','PPO learning'),
  number('ppo','entCoef','Entropy weight',.001,0,1e6,'Weight encouraging exploration.','PPO learning'),
  number('ppo','lr','Initial learning rate',.0003,1e-12,1,'Adam learning rate at the beginning of the run.','Optimizer'),
  number('ppo','lrEnd','Final learning rate',.0003,0,1,'Equal to the initial rate for constant learning rate.','Optimizer'),
  number('ppo','lrIterations','Learning rate schedule (iterations)',1,1,2147483647,'Linearly reaches the final rate after this many iterations.','Optimizer',true),
  number('ppo','maxNorm','Gradient norm limit',.5,1e-12,1e6,'Maximum gradient norm before an optimizer update.','Optimizer'),
  number('ppo','adamBeta1','Adam beta 1',.9,0,.99999999,'First moment decay.','Optimizer'),
  number('ppo','adamBeta2','Adam beta 2',.999,0,.99999999,'Second moment decay.','Optimizer'),
  number('ppo','adamEps','Adam epsilon',.00001,1e-12,1,'Numerical stabilizer in the optimizer denominator.','Optimizer'),
  number('ppo','logStdInit','Initial action log standard deviation',-.7,-20,10,'New brains only; continued brains keep their learned action spread.','Exploration'),
  number('ppo','logStdMin','Minimum action log standard deviation',-3,-20,10,'Lower clamp applied by the optimizer.','Exploration'),
  number('ppo','logStdMax','Maximum action log standard deviation',.5,-20,10,'Upper clamp applied by the optimizer.','Exploration'),
  number('env','progressReward','Progress reward per metre',1,-1e6,1e6,'Reward for moving along the course toward the next gate.','Rewards and penalties'),
  number('env','gateReward','Gate reward',5,-1e6,1e6,'Reward for clearing the next gate in order.','Rewards and penalties'),
  number('env','crashPenalty','Crash penalty',10,-1e6,1e6,'Positive values subtract reward on a crash or leaving the world.','Rewards and penalties'),
  number('env','stallPenalty','Stall penalty',2,-1e6,1e6,'Positive values subtract reward when progress stalls.','Rewards and penalties'),
  number('env','ratePenalty','Angular rate penalty',.0002,-1e6,1e6,'Per-step penalty × squared body angular rate in rad/s.','Rewards and penalties'),
  number('env','smoothPenalty','Action change penalty',.02,-1e6,1e6,'Per-step penalty × squared change in action.','Rewards and penalties'),
  number('env','stallSeconds','Stall timeout (seconds)',8,.02,86400,'Episode ends if no gate is cleared for this long.','Episodes'),
  number('env','episodeSeconds','Episode limit (seconds)',60,.02,86400,'Maximum length of one episode.','Episodes'),
  number('env','ceiling','Flight ceiling above terrain (metres)',120,.01,1e6,'Leaving this height above the highest terrain ends the episode.','Episodes'),
  number('env','batteryEmptyV','Empty battery voltage per cell',3,0,10,'Episode ends below this cell voltage.','Episodes'),
  number('env','padSpawnProb','Pad spawn probability',.2,0,1,'Remaining episodes start at a random checkpoint gate, the way the game respawns a quad.','Spawn and weather'),
  number('env','calmProb','Still-air probability',.3,0,1,'Remaining episodes receive randomized wind.','Spawn and weather'),
  number('env','windMax','Maximum mean wind (m/s)',8,0,1000,'Random wind strength up to this limit.','Spawn and weather'),
  number('env','altMax','Maximum site altitude (metres)',1500,0,20000,'Air density varies with randomized site altitude.','Spawn and weather'),
  number('env','tempMin','Minimum air temperature (°C)',5,-100,100,'Lower bound of randomized temperature.','Spawn and weather'),
  number('env','tempMax','Maximum air temperature (°C)',30,-100,100,'Upper bound of randomized temperature.','Spawn and weather'),
  number('ppo','traceEnvs','Traced drones',256,0,32768,'0 disables flight traces. Otherwise a multiple of 16, at most the environment count.','Monitoring',true),
  {scope:'ppo',key:'profile',label:'GPU profiling',default:false,type:'boolean',help:'Collect kernel timestamps when supported. Adds timing overhead.',group:'Monitoring'},
];
export const TRAINING_STYLES = ['race','freestyle','mountain','sprint','technical','acro','industrial'];
export function trainingDefaults() {
  return Object.fromEntries(['ppo','env'].map(scope => [scope,Object.fromEntries(TRAINING_FIELDS.filter(f=>f.scope===scope).map(f=>[f.key,Array.isArray(f.default)?[...f.default]:f.default]))]));
}
export function validateTrainingConfig(ppoInput = {}, envInput = {}) {
  const result = trainingDefaults();
  for (const [scope,input] of [['ppo',ppoInput],['env',envInput]]) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error(`Invalid ${scope} settings`);
    for (const key of Object.keys(input)) if (!TRAINING_FIELDS.some(f=>f.scope===scope && f.key===key)) throw Error(`Unknown ${scope} setting: ${key}`);
    Object.assign(result[scope],input);
  }
  if (!Object.hasOwn(ppoInput,'lrEnd')) result.ppo.lrEnd = result.ppo.lr;
  if (!Object.hasOwn(ppoInput,'traceEnvs')) result.ppo.traceEnvs = Math.min(256,result.ppo.envs);
  for (const field of TRAINING_FIELDS) {
    const value = result[field.scope][field.key];
    if (field.type === 'boolean') { if (typeof value !== 'boolean') throw Error(`${field.label} must be on or off`); }
    else if (field.type === 'layers') {
      if (!Array.isArray(value) || !value.length || value.length > 8 || value.some(v=>!Number.isInteger(v)||v<1||v>4096)) throw Error('Use 1–8 hidden layers, each containing 1–4096 units');
    } else if (!Number.isFinite(value) || value < field.min || value > field.max || (field.integer && !Number.isInteger(value))) throw Error(`${field.label} must be ${field.integer?'an integer ':''}between ${field.min} and ${field.max}`);
  }
  const p = result.ppo, e = result.env, batch = p.envs*p.steps/p.minibatches;
  if (p.envs%128 || p.chunk%16 || !Number.isInteger(batch) || batch%256 || batch%p.chunk) throw Error('Environments must be a multiple of 128; gradient chunk a multiple of 16; minibatch size (environments × steps ÷ minibatches) must be a multiple of 256 and the chunk size.');
  if (p.traceEnvs%16 || p.traceEnvs>p.envs) throw Error('Traced drones must be a multiple of 16 and at most the environment count');
  if (p.logStdMin>p.logStdMax) throw Error('Minimum action spread must not exceed maximum');
  if (e.tempMin>e.tempMax) throw Error('Minimum air temperature must not exceed maximum');
  return result;
}
