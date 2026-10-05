// Admission only: never changes a native run's frames, pacing or timing scope.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ROOT, parseArgs, checkArgs } from '../native-bench/common.mjs';
const args=parseArgs(process.argv.slice(2));checkArgs(args,['out','seconds']);
if(typeof args.out!=='string')throw new Error('--out required');
const maxSeconds=Number(args.seconds??600);
if(!Number.isFinite(maxSeconds)||maxSeconds<=0)throw new Error('--seconds must be positive');
const output=resolve(ROOT,args.out),exec=promisify(execFile),started=Date.now();
const report={startedAt:new Date().toISOString(),passed:false,requiredQuietReadings:5,cpuLimitPercent:50,observations:[]};
await writeFile(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
let quiet=0;
while((Date.now()-started)/1000<maxSeconds) {
  const {stdout}=await exec('pwsh',['-NoProfile','-NonInteractive','-Command',"(Get-CimInstance Win32_PerfFormattedData_PerfOS_Processor | Where-Object Name -eq '_Total').PercentProcessorTime"],{windowsHide:true,timeout:15000,maxBuffer:4096});
  const cpu=Number(stdout.trim());
  if(!Number.isFinite(cpu)||cpu<0||cpu>100)throw new Error('Could not read host CPU utilization');
  quiet=cpu<50?quiet+1:0;
  report.observations.push({at:new Date().toISOString(),cpuPercent:cpu,quietReadings:quiet});
  report.waitSeconds=(Date.now()-started)/1000;
  report.passed=quiet>=5;
  await writeFile(output,JSON.stringify(report,null,2)+'\n');
  if(report.passed) {console.log(`Final host readiness passed after ${report.waitSeconds.toFixed(1)} seconds`);process.exit(0);}
  await new Promise(accept=>setTimeout(accept,cpu<50?3000:10000));
}
report.finishedAt=new Date().toISOString();report.reason='No five-reading quiet window before the admission timeout';
await writeFile(output,JSON.stringify(report,null,2)+'\n');
throw new Error(report.reason);
