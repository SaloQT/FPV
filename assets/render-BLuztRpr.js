import{At as e,Bt as t,Ct as n,Dt as r,Et as i,Ft as a,Gt as o,Ht as s,It as c,Jt as l,Kt as u,Lt as d,Mt as f,Nt as p,Ot as m,Pt as h,Q as g,Rt as _,St as v,Tt as y,Ut as b,Vt as x,Yt as S,Z as C,_t as w,at as T,bt as E,ct as D,dt as O,et as k,ft as A,gt as j,ht as M,it as ee,jt as te,kt as ne,lt as re,mt as ie,ot as ae,qt as oe,rt as se,st as ce,tt as le,ut as ue,vt as de,wt as fe,xt as pe,yt as me,zt as he}from"./world-Bb7FrvoC.js";import{t as ge}from"./shaders-Bpf8PkZH.js";var _e={levels:6,energy:.05,glare:.015,soft:[.28,.24,.2,.14,.09,.05],veil:[0,0,0,.2,.35,.45]},ve=`rgba16float`;function ye(){return _e.energy+_e.glare}function be(){let e=_e;return e.soft.map((t,n)=>e.energy*t+e.glare*e.veil[n])}function xe(e,t,n=_e.levels){let r=Math.max(1,Math.floor(e)||1),i=Math.max(1,Math.floor(t)||1),a=[];for(let e=0;e<n;e++)r=Math.max(1,Math.ceil(r/2)),i=Math.max(1,Math.ceil(i/2)),a.push({width:r,height:i});return a}function Se(){let e,t,n,r,i,a,o,s=[],c=0,l=0,u=[],d=[],f=null,p=null,m=[],h=[],g=null,_=[],v=!0;function y(){for(let e of s)e.tex.destroy();s=[],u=[],d=[],m=[],h=[],g=null,f=p=null}function b(r,i){return e.createBindGroup({label:i,layout:t,entries:[{binding:0,resource:r},{binding:1,resource:n}]})}function x(n,r,i){return e.createRenderPipeline({label:`bloom ${r}${i?` blend`:``}`,layout:e.createPipelineLayout({bindGroupLayouts:[t]}),vertex:{module:n,entryPoint:`vs`},fragment:{module:n,entryPoint:r,targets:[{format:ve,blend:i}]},primitive:{topology:`triangle-list`}})}function S(e,t,n,r,i){let a=e.beginRenderPass(t);a.setPipeline(n),a.setBindGroup(0,r),i&&a.setBlendConstant(i),a.draw(3),a.end()}return{init(s){e=s.device;let c=GPUShaderStage.FRAGMENT;t=e.createBindGroupLayout({label:`bloom`,entries:[{binding:0,visibility:c,texture:{sampleType:`float`}},{binding:1,visibility:c,sampler:{type:`filtering`}}]}),n=e.createSampler({label:`bloom linear clamp`,magFilter:`linear`,minFilter:`linear`,addressModeU:`clamp-to-edge`,addressModeV:`clamp-to-edge`});let l=s.module(`post/bloom.wgsl`),u=(e,t)=>{let n={operation:`add`,srcFactor:e,dstFactor:t};return{color:n,alpha:n}};r=x(l,`fs_down_karis`),i=x(l,`fs_down`),a=x(l,`fs_down`,u(`constant`,`zero`)),o=x(l,`fs_up`,u(`one`,`constant`))},resize(t,n){let r=xe(n.width,n.height);if(s.length===r.length&&r[0].width===c&&r[0].height===l)return;y(),c=r[0].width,l=r[0].height;let i=GPUTextureUsage;s=r.map((t,n)=>{let r=e.createTexture({label:`bloom level ${n}`,format:ve,size:[t.width,t.height],usage:i.TEXTURE_BINDING|i.RENDER_ATTACHMENT|i.COPY_SRC});return{tex:r,view:r.createView()}});let a=s.length,o=(e,t)=>({label:`bloom ${t===`load`?`up`:`down`} ${e}`,colorAttachments:[{view:s[e].view,loadOp:t,storeOp:`store`,clearValue:[0,0,0,0]}]});m=s.map((e,t)=>o(t,`clear`)),h=s.slice(0,a-1).map((e,t)=>o(t,`load`)),g={label:`bloom clear`,colorAttachments:[{view:s[0].view,loadOp:`clear`,storeOp:`store`,clearValue:[0,0,0,0]}]},u=s.slice(0,a-1).map((e,t)=>b(e.view,`bloom down ${t+1}`)),d=s.slice(1).map((e,t)=>b(e.view,`bloom up ${t}`)),_=be().map(e=>[e,e,e,e]),v=!0},encode(e,t,n,c,l,y){let x=s.length;if(x!==0&&g){if(!l.bloom){v||=(e.beginRenderPass(g).end(),!0);return}v=!1,y!==p&&(p=y,f=b(y,`bloom down 0`)),S(e,m[0],r,f);for(let t=1;t<x-1;t++)S(e,m[t],i,u[t-1]);S(e,m[x-1],a,u[x-2],_[x-1]);for(let t=x-2;t>=0;t--)S(e,h[t],o,d[t],_[t])}},get output(){return s[0].view},get outputTexture(){return s[0].tex},destroy(){y()}}}var Ce={readout:.008,omegaTau:.02,maxOmega:40,k1:-.25,k2:.05,caEdgePx:.8,softEdgePx:1.2,vignetteBase:.35,noiseGain:2,jelloPx:.45,jelloRefOmega:2500},we=Math.PI*2,Te=112,Ee=e=>e>0?e<1?e:1:0;function De(e){let t=Ee(e),n=Ce.k1*t,r=Ce.k2*t;return{k1:n,k2:r,zoom:1+n+r}}function Oe(e){return e.endsWith(`-srgb`)?{hwSrgb:!0,ditherLsb:1/255}:e===`rgb10a2unorm`?{hwSrgb:!1,ditherLsb:1/1023}:e===`rgba16float`?{hwSrgb:!1,ditherLsb:0}:{hwSrgb:!1,ditherLsb:1/255}}function ke(e,t,n,r){let[i,a,o,s]=t,[c,l,u,d]=n,f=s*c-i*d-a*u+o*l,p=s*l+i*u-a*d-o*c,m=s*u-i*l+a*c-o*d,h=s*d+i*c+a*l+o*u;h<0&&(f=-f,p=-p,m=-m,h=-h);let g=Math.hypot(f,p,m),_=2*Math.atan2(g,h),v=g>1e-12&&r>0?_/(g*r):0;return e[0]=f*v,e[1]=p*v,e[2]=m*v,_}function Ae(e){let t=Ee(Math.abs(e)/Ce.jelloRefOmega);return Ce.jelloPx*t*t}function je(){let e,t,n,r,i,a=null,o=null,s=null,c=null,l=null,u=null,d=new ArrayBuffer(Te),f=new Float32Array(d),p=new Uint32Array(d),m=[0,0,0,1],h=[0,0,0],g=[0,0,0],_=!1,v=-1,y=0,b=0,x=0;return{init(a){e=a.device;let o=GPUShaderStage.FRAGMENT;t=e.createBindGroupLayout({label:`composite`,entries:[{binding:0,visibility:o,texture:{sampleType:`float`}},{binding:1,visibility:o,texture:{sampleType:`float`}},{binding:2,visibility:o,sampler:{type:`filtering`}},{binding:3,visibility:o,buffer:{type:`uniform`,minBindingSize:32}},{binding:4,visibility:o,buffer:{type:`uniform`,minBindingSize:Te}}]}),r=e.createSampler({label:`composite linear clamp`,magFilter:`linear`,minFilter:`linear`,addressModeU:`clamp-to-edge`,addressModeV:`clamp-to-edge`}),i=e.createBuffer({label:`composite params`,size:Te,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});let s=Oe(a.canvasFormat),c=a.module(`post/composite.wgsl`,{DITHER_LSB:s.ditherLsb,OUT_HW_SRGB:s.hwSrgb});n=e.createRenderPipeline({label:`composite`,layout:e.createPipelineLayout({bindGroupLayouts:[t]}),vertex:{module:c,entryPoint:`vs`},fragment:{module:c,entryPoint:`fs`,targets:[{format:a.canvasFormat}]},primitive:{topology:`triangle-list`}})},resize(e,t){a=null},update(e,t){if(t.frameIndex===v)return;v=t.frameIndex;let n=Ce,r=t.camera.quat,i=0;if(_&&t.dt>1e-6&&(ke(h,m,r,t.dt),i=Math.hypot(h[0],h[1],h[2])),i>n.maxOmega||!_||t.dt<=1e-6)g[0]=g[1]=g[2]=0;else{let e=1-Math.exp(-t.dt/n.omegaTau);for(let t=0;t<3;t++)g[t]+=(h[t]-g[t])*e}m[0]=r[0],m[1]=r[1],m[2]=r[2],m[3]=r[3],_=!0;let a=t.quad?.motorOmega,o=a?(Math.abs(a[0])+Math.abs(a[1])+Math.abs(a[2])+Math.abs(a[3]))/4:0;b=o/we,x=Ae(o),y=(y+we*b*Math.max(t.dt,0))%we},encode(m,h,_,v,S){let C=Ce,w=Math.max(1,v.outWidth),T=Math.max(1,v.outHeight),E=Ee(h.settings.lensDistortion),D=Ee(h.settings.videoNoise),O=De(E);f[0]=w,f[1]=T,f[2]=1/w,f[3]=1/T,f[4]=O.k1,f[5]=O.k2,f[6]=O.zoom,f[7]=C.caEdgePx*E/(.5*Math.hypot(w,T)),f[8]=C.vignetteBase+(1-C.vignetteBase)*E,f[9]=C.softEdgePx*E,f[10]=h.quality.bloom?ye():0,f[11]=C.noiseGain*D,f[12]=g[0],f[13]=g[1],f[14]=g[2],f[15]=.5*T/Math.tan(.5*_.camera.fovY),f[16]=x,f[17]=y,f[18]=we*b*C.readout,f[19]=C.readout,f[20]=D,p[24]=_.frameIndex>>>0,p[25]=S.debug,e.queue.writeBuffer(i,0,d),(!a||o!==S.resolved||s!==S.bloom||c!==S.exposure)&&(o=S.resolved,s=S.bloom,c=S.exposure,a=e.createBindGroup({label:`composite`,layout:t,entries:[{binding:0,resource:S.resolved},{binding:1,resource:S.bloom},{binding:2,resource:r},{binding:3,resource:{buffer:S.exposure,size:32}},{binding:4,resource:{buffer:i}}]})),(!l||!u)&&(l={view:S.target,loadOp:`clear`,storeOp:`store`,clearValue:[0,0,0,1]},u={label:`composite`,colorAttachments:[l]}),l.view=S.target;let k=m.beginRenderPass(u);k.setPipeline(n),k.setBindGroup(0,a),k.draw(3),k.end()},destroy(){i?.destroy(),a=null}}}var Me=127e3,Ne=3e-5,Pe=1e-6,Fe=1e4,Ie=.25;function Le(e){let t=Math.abs(e);return 10**(-.4*(-12.73+1.49*t+.043*t*t*t*t+14.18))}var Re=[-18,-12,-6,0,10,30,60,90],ze=[-3.1,-2,.53,2.6,3.6,4.1,4.3,4.3];function Be(e){let t=180/Math.PI*e;if(t<=Re[0])return 10**ze[0];for(let e=1;e<Re.length;e++)if(t<=Re[e]){let n=(t-Re[e-1])/(Re[e]-Re[e-1]);return 10**(ze[e-1]+(ze[e]-ze[e-1])*n)}return 10**ze[ze.length-1]}function Ve(e){let t=180/Math.PI*Math.max(e,0);return 1/(Math.sin(Math.max(e,0))+.50572*(6.07995+t)**-1.6364)}function He(e,t){let n=Math.exp(-Math.max(t,0)/8500),r=Math.exp(-.1*n*Ve(e.sunElevation)),i=.18/Math.PI*Me*r*Math.max(Math.sin(e.sunElevation),0),a=.18/Math.PI*Be(e.sunElevation),o=Math.exp(-.1*n*Ve(e.moonElevation)),s=.18/Math.PI*Le(e.moonPhaseAngle)*o*Math.max(Math.sin(e.moonElevation),0);return Math.max(i+a+s,Ne)}function Ue(e){return Math.min(Fe,Math.max(Pe,Ie/e))}var We=class{logCur=0;logPrev=0;primed=!1;timeConstant=.4;maxStep=Math.log(1.02);get preExposure(){return Math.exp(this.logCur)}get prevPreExposure(){return Math.exp(this.logPrev)}update(e,t,n){let r=Math.log(Ue(He(t,n)));if(this.logPrev=this.logCur,!this.primed){this.logCur=this.logPrev=r,this.primed=!0;return}let i=1-Math.exp(-Math.max(e,0)/this.timeConstant),a=(r-this.logCur)*i;this.logCur+=Math.max(-this.maxStep,Math.min(this.maxStep,a))}reset(){this.primed=!1}},N={bins:64,evMin:-10,evMax:12,key:.3,keyKneeNits:100,keySlope:.3,keyNightKneeNits:.78,keyNightSlope:.05,nightBlendHiNits:.03,nightBlendLoNits:.003,nightMarginEv:2,nightLampEv:1,nightLiftFromEv:1,nightLiftRate:.5,nightLiftMaxEv:2,trimLow:.3,trimLowNight:.05,trimBlendLoNits:.03,trimBlendHiNits:.3,trimHigh:.05,knee:3,kneeWidth:1.5,centerBias:.6,vertBias:.3,clipFrac:.12,clipEv:1.5,protectMaxEv:3,sparseClipFrac:.03,sparseClipExtraEv:.8,skyCapEv:2,skyGroundLo:.03,skyGroundHi:.12,hlKneeEv:0,hlTau:.5,hlGapLo:2.5,hlGapHi:4,stride:2,weightScale:64,tauBrighten:.35,tauDarken:.15,deadbandEv:.04,maxDt:.25,dayReferenceNits:5e3,maxGainEv:24.5,skyHoldGainEv:22,minGainEv:-6,maxRatioEv:26},Ge=-Math.log2(4*N.dayReferenceNits),Ke=Math.log2(N.key),qe=Math.log2(N.keyKneeNits),Je=Math.log2(N.keyNightKneeNits),Ye=Math.log2(N.nightBlendHiNits),Xe=Math.log2(N.nightBlendLoNits),Ze=Math.log2(N.trimBlendLoNits),Qe=Math.log2(N.trimBlendHiNits),$e=Math.log2(Ie),et=40;function tt(e){return Ke+N.keySlope*Math.min(e-qe,0)+(N.keyNightSlope-N.keySlope)*Math.min(e-Je,0)}function nt(e){let t=Math.min(Math.max(($e-e-Xe)/(Ye-Xe),0),1);return 1-t*t*(3-2*t)}function rt(e,t,n=-1/0,r=-1/0){let i=Math.log2(Math.max(t,1e-12)),a=nt(i),o=e+a*($e-e),s=tt(o-i)-o,c=s+(1-a)*(Math.max(Math.min(s,Ke+N.clipEv-n),s-N.protectMaxEv)-s),l=a*Math.max(e-$e-N.nightMarginEv,0),u=a*Math.min(Math.max($e-e-N.nightLiftFromEv,0)*N.nightLiftRate,N.nightLiftMaxEv),d=Math.max(Math.min(Math.max(i+c-Ge+u,N.minGainEv),N.maxGainEv)-l,N.minGainEv),f=i+Ke+N.clipEv+N.nightLampEv-r-Ge,p=Math.max(d+a*(Math.min(d,f)-d),N.minGainEv);return i+Math.min(Math.max(Ge+p-i,-N.maxRatioEv),N.maxRatioEv)}function it(e){let t=rt($e,e)-Ge;return 2**-Math.max(t-N.skyHoldGainEv,0)}function at(){return{EV_MIN:N.evMin,EV_MAX:N.evMax,KEY:N.key,KEY_KNEE_EV:qe,KEY_SLOPE:N.keySlope,NIGHT_KNEE_EV:Je,NIGHT_SLOPE:N.keyNightSlope,NIGHT_BLEND_HI_EV:Ye,NIGHT_BLEND_LO_EV:Xe,NIGHT_MARGIN_EV:N.nightMarginEv,NIGHT_LAMP_EV:N.nightLampEv,NIGHT_LIFT_FROM_EV:N.nightLiftFromEv,NIGHT_LIFT_RATE:N.nightLiftRate,NIGHT_LIFT_MAX_EV:N.nightLiftMaxEv,EXPECTED_MEAN_EV:$e,KNEE:N.knee,KNEE_WIDTH:N.kneeWidth,CENTER_BIAS:N.centerBias,VERT_BIAS:N.vertBias,CLIP_FRAC:N.clipFrac,CLIP_EV:N.clipEv,SPARSE_CLIP_FRAC:N.sparseClipFrac,SPARSE_CLIP_EXTRA_EV:N.sparseClipExtraEv,PROTECT_MAX_EV:N.protectMaxEv,STRIDE:N.stride,WEIGHT_SCALE:N.weightScale,TRIM_LOW:N.trimLow,TRIM_LOW_NIGHT:N.trimLowNight,TRIM_BLEND_LO_EV:Ze,TRIM_BLEND_HI_EV:Qe,TRIM_HIGH:N.trimHigh,SKY_CAP_EV:N.skyCapEv,HL_KNEE_EV:N.hlKneeEv,HL_TAU:N.hlTau,HL_GAP_LO:N.hlGapLo,HL_GAP_HI:N.hlGapHi,SKY_GROUND_LO:N.skyGroundLo,SKY_GROUND_HI:N.skyGroundHi,SKY_UNCAPPED_EV:et,TAU_BRIGHTEN:N.tauBrighten,TAU_DARKEN:N.tauDarken,DEADBAND:N.deadbandEv,MAX_DT:N.maxDt,DAY_TOTAL_EV:Ge,MAX_GAIN_EV:N.maxGainEv,MIN_GAIN_EV:N.minGainEv,MAX_RATIO_EV:N.maxRatioEv}}var ot=16,st=32,ct=0xe8d4a51000;function lt(){let e,t,n,r,i,a,o,s,c,l=null,u=null,d=null,f=0,p=0,m=!1,h=`idle`,g=null,_=new ArrayBuffer(16),v=new Float32Array(_),y=new Uint32Array(_),b=new Float32Array([1,0,0,0,ct,0,0,0]);function x(){h=`mapping`,c.mapAsync(GPUMapMode.READ).then(()=>{let e=new Float32Array(c.getMappedRange().slice(0,16))[0];c.unmap(),e>0&&Number.isFinite(e)&&(g=Math.log2(e)),h=`idle`}).catch(()=>{h=`idle`})}return{init(l){e=l;let u=GPUShaderStage.COMPUTE,d=(e,t)=>({binding:e,visibility:u,buffer:{type:t}});t=e.device.createBindGroupLayout({label:`exposure`,entries:[{binding:0,visibility:u,texture:{sampleType:`float`}},d(1,`storage`),d(2,`uniform`),d(3,`storage`),d(4,`storage`),{binding:5,visibility:u,texture:{sampleType:`depth`}}]});let f=e.module(`post/histogram.wgsl`,at()),p=e.device.createPipelineLayout({bindGroupLayouts:[t]}),m=t=>e.device.createComputePipeline({label:`exposure ${t}`,layout:p,compute:{module:f,entryPoint:t}});n=m(`hist`),r=m(`reduce`);let h=GPUBufferUsage;i=e.device.createBuffer({label:`exposure histogram`,size:N.bins*2*4,usage:h.STORAGE}),a=e.device.createBuffer({label:`exposure params`,size:16,usage:h.UNIFORM|h.COPY_DST}),o=e.device.createBuffer({label:`exposure state`,size:16,usage:h.STORAGE}),s=e.device.createBuffer({label:`exposure ratio`,size:st,usage:h.STORAGE|h.UNIFORM|h.COPY_SRC|h.COPY_DST}),c=e.device.createBuffer({label:`exposure readback`,size:16,usage:h.MAP_READ|h.COPY_DST}),e.device.queue.writeBuffer(s,0,b)},resize(t,n){e=t,f=n.width,p=n.height,l=null,u=null,d=null},encode(e,g,b,S,C,w){(u!==w||d!==g.gbuf.views.depth)&&(l=g.device.createBindGroup({label:`exposure`,layout:t,entries:[{binding:0,resource:w},{binding:1,resource:{buffer:i}},{binding:2,resource:{buffer:a}},{binding:3,resource:{buffer:o}},{binding:4,resource:{buffer:s}},{binding:5,resource:g.gbuf.views.depth}]}),u=w,d=g.gbuf.views.depth),v[0]=S.preExposure,v[1]=b.dt,y[2]=b.frameIndex>>>0,y[3]=+!!C.reset,g.device.queue.writeBuffer(a,0,_);let T=ot*N.stride,E=e.beginComputePass({label:`exposure`});E.setBindGroup(0,l),E.setPipeline(n),E.dispatchWorkgroups(Math.ceil(Math.max(f,1)/T),Math.ceil(Math.max(p,1)/T)),E.setPipeline(r),E.dispatchWorkgroups(1),E.end(),m&&(h===`copied`?x():h===`idle`&&(e.copyBufferToBuffer(s,0,c,0,16),h=`copied`))},get ratio(){return s},getStats(){return m=!0,{exposureEv:g}},destroy(){i?.destroy(),a?.destroy(),o?.destroy(),s?.destroy(),c?.destroy(),l=null,u=null,d=null}}}var ut={exposureTime:1/400,maxShutter:1,samples:10,tile:16,maxBlurPx:32,maxBlurFrac:.03,minBlurPx:1,depthSoftRel:.08,depthSoftMin:.1};function dt(e,t){return{x:Math.ceil(e/ut.tile),y:Math.ceil(t/ut.tile)}}function ft(){let e=ut;return{TILE:e.tile,SAMPLES:e.samples,EXPOSURE_TIME:e.exposureTime,MAX_SHUTTER:e.maxShutter,MAX_BLUR_PX:e.maxBlurPx,MAX_BLUR_FRAC:e.maxBlurFrac,MIN_BLUR_PX:e.minBlurPx,DEPTH_SOFT_REL:e.depthSoftRel,DEPTH_SOFT_MIN:e.depthSoftMin}}var pt=8;function mt(){let e,t,n,r,i,a=null,o=null,s=null,c=null,l=null,u=new Float32Array(4),d=null,f=0,p=0,m={x:0,y:0},h=!1;function g(){a?.destroy(),s?.destroy(),c?.destroy(),a=o=s=c=d=null}return{init(a){e=a;let o=GPUShaderStage.COMPUTE,s=(e,t)=>({binding:e,visibility:o,texture:{sampleType:t}}),c=e=>({binding:e,visibility:o,buffer:{type:`storage`}});t=e.device.createBindGroupLayout({label:`motion blur`,entries:[s(0,`float`),s(1,`float`),s(2,`depth`),c(3),c(4),{binding:5,visibility:o,storageTexture:{access:`write-only`,format:`rgba16float`}},{binding:6,visibility:o,buffer:{type:`uniform`}}]}),l??=e.device.createBuffer({label:`motion blur params`,size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});let u=e.module(`post/motionblur.wgsl`,ft()),d=e.device.createPipelineLayout({bindGroupLayouts:[e.frame.layout,t]}),f=t=>e.device.createComputePipeline({label:`motion blur ${t}`,layout:d,compute:{module:u,entryPoint:t}});n=f(`tile_max`),r=f(`neighbor_max`),i=f(`blur`)},resize(n,r){e=n,g();let i=e.gbuf;f=i.width,p=i.height,m=dt(f,p);let u=GPUTextureUsage;a=e.device.createTexture({label:`motion blur out`,format:`rgba16float`,size:[f,p],usage:u.STORAGE_BINDING|u.TEXTURE_BINDING}),o=a.createView();let h=m.x*m.y*8;s=e.device.createBuffer({label:`mb tile max`,size:h,usage:GPUBufferUsage.STORAGE}),c=e.device.createBuffer({label:`mb tile neighbour`,size:h,usage:GPUBufferUsage.STORAGE}),d=e.device.createBindGroup({label:`motion blur`,layout:t,entries:[{binding:0,resource:i.views.hdr},{binding:1,resource:i.views.motion},{binding:2,resource:i.views.depth},{binding:3,resource:{buffer:s}},{binding:4,resource:{buffer:c}},{binding:5,resource:o},{binding:6,resource:{buffer:l}}]})},encode(e,t,a,o,s){if(h=!1,s.reset||!d||!l)return;h=!0,u[0]=it(o.preExposure),t.device.queue.writeBuffer(l,0,u);let c=e.beginComputePass({label:`motion blur`});c.setBindGroup(0,t.frame.group),c.setBindGroup(1,d),c.setPipeline(n),c.dispatchWorkgroups(m.x,m.y),c.setPipeline(r),c.dispatchWorkgroups(Math.ceil(m.x/pt),Math.ceil(m.y/pt)),c.setPipeline(i),c.dispatchWorkgroups(Math.ceil(f/pt),Math.ceil(p/pt)),c.end()},get output(){return h&&o?o:e.gbuf.views.hdr},destroy(){g(),l?.destroy(),l=null}}}var ht={kernelK:4,varianceGamma:1.25,feedback:.9,feedbackMotion:.7,motionPx:10,disoccLo:.06,disoccHi:.18},gt=`rgba16float`,_t=16,vt=8,yt=4;function bt(e,t){let n=e/t;return Number.isFinite(n)&&n>0?n:1}function xt(e,t){return e.taa&&!e.reset&&t}function St(){let e=ht;return{KERNEL_K:e.kernelK,VARIANCE_GAMMA:e.varianceGamma,FEEDBACK:e.feedback,FEEDBACK_MOTION:e.feedbackMotion,MOTION_PX:e.motionPx,DISOCC_LO:e.disoccLo,DISOCC_HI:e.disoccHi}}function Ct(){let e,t,n,r,i,a,o,s,c=new ArrayBuffer(_t),l=new Float32Array(c),u=new Uint32Array(c),d=0,f=0,p=null,m,h=[],g=[],_=[],v=[],y=0,b=!1,x=(t,n)=>e.createTexture({label:t,size:[d,f],format:gt,usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.STORAGE_BINDING|n}),S=()=>{p?.destroy();for(let e of h)e.destroy();p=null,h=[],g=[]},C=t=>{for(let e of v)if(e.view===t)return e.group;v.length>=yt&&v.shift();let n=e.createBindGroup({label:`taa input`,layout:a,entries:[{binding:0,resource:t}]});return v.push({view:t,group:n}),n};return{init(c){e=c.device;let l=GPUShaderStage.COMPUTE;r=c.frame.layout,i=e.createBindGroupLayout({label:`taa state`,entries:[{binding:0,visibility:l,buffer:{type:`uniform`}},{binding:1,visibility:l,texture:{sampleType:`float`}},{binding:2,visibility:l,sampler:{type:`filtering`}},{binding:3,visibility:l,storageTexture:{access:`write-only`,format:gt}},{binding:4,visibility:l,storageTexture:{access:`write-only`,format:gt}},{binding:5,visibility:l,texture:{sampleType:`float`}},{binding:6,visibility:l,texture:{sampleType:`depth`}}]}),a=e.createBindGroupLayout({label:`taa input`,entries:[{binding:0,visibility:l,texture:{sampleType:`float`}}]});let u=e.createPipelineLayout({label:`taa`,bindGroupLayouts:[r,i,a]}),d=c.module(`post/taau.wgsl`,St());t=e.createComputePipeline({label:`taau`,layout:u,compute:{module:d,entryPoint:`main`}}),n=e.createComputePipeline({label:`taau upsample`,layout:u,compute:{module:d,entryPoint:`upsample`}}),o=e.createSampler({label:`taa linear`,magFilter:`linear`,minFilter:`linear`,addressModeU:`clamp-to-edge`,addressModeV:`clamp-to-edge`}),s=e.createBuffer({label:`taa params`,size:_t,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST})},resize(t,n){(n.width!==d||n.height!==f||!p)&&(S(),d=n.width,f=n.height,p=x(`taa resolved`,GPUTextureUsage.COPY_SRC),m=p.createView(),h=[x(`taa history 0`,0),x(`taa history 1`,0)],g=h.map(e=>e.createView()),b=!1),v=[];let r=t.gbuf.views;_=[0,1].map(t=>e.createBindGroup({label:`taa state ${t}`,layout:i,entries:[{binding:0,resource:{buffer:s}},{binding:1,resource:g[t]},{binding:2,resource:o},{binding:3,resource:m},{binding:4,resource:g[1-t]},{binding:5,resource:r.motion},{binding:6,resource:r.depth}]}))},encode(r,i,a,o,p,m){let h=xt(p,b);l[0]=bt(o.preExposure,o.prevPreExposure),u[1]=+!h,l[2]=it(o.preExposure),e.queue.writeBuffer(s,0,c);let g=r.beginComputePass({label:p.taa?`taau`:`taa off upsample`});g.setPipeline(p.taa?t:n),g.setBindGroup(0,i.frame.group),g.setBindGroup(1,_[y]),g.setBindGroup(2,C(m)),g.dispatchWorkgroups(Math.ceil(d/vt),Math.ceil(f/vt)),g.end(),b=p.taa,p.taa&&(y=1-y)},get resolved(){return m},get resolvedTexture(){return p},destroy(){S(),s?.destroy()}}}var wt={stride:4,maxDistance:150,minCount:64,strength:1,soft:.8,tau:1.5,maxDt:.25,gainLo:9,gainHi:14,nightRG:-.3,nightBG:.45,sunLo:-.07,sunHi:.035,warmRG:.06,warmBG:-.12,warmSunHi:.26},Tt=8;function Et(){let e=e=>Number.isInteger(e)?`${e}.0`:`${e}`;return{WB_STRIDE:wt.stride,WB_MAX_DIST:e(wt.maxDistance),WB_MIN_COUNT:e(wt.minCount),WB_STRENGTH:e(wt.strength),WB_SOFT:e(wt.soft),WB_TAU:e(wt.tau),WB_MAX_DT:e(wt.maxDt),WB_GAIN_LO:e(wt.gainLo),WB_GAIN_HI:e(wt.gainHi),WB_SUN_LO:e(wt.sunLo),WB_SUN_HI:e(wt.sunHi),WB_NIGHT_RG:e(wt.nightRG),WB_NIGHT_BG:e(wt.nightBG),WB_WARM_RG:e(wt.warmRG),WB_WARM_BG:e(wt.warmBG),WB_WARM_SUN_HI:e(wt.warmSunHi)}}function Dt(){let e,t,n,r,i,a,o=null,s=null,c=new ArrayBuffer(16),l=new Float32Array(c),u=new Uint32Array(c);return{init(o){let s=GPUShaderStage.COMPUTE,c=e=>({binding:e,visibility:s,texture:{sampleType:`unfilterable-float`}}),l=(e,t)=>({binding:e,visibility:s,buffer:{type:t}});e=o.device.createBindGroupLayout({label:`white balance`,entries:[c(0),c(1),{binding:2,visibility:s,texture:{sampleType:`depth`}},c(3),c(4),l(5,`uniform`),l(6,`storage`),l(7,`storage`),l(8,`storage`)]});let u=o.module(`post/whitebalance.wgsl`,Et()),d=o.device.createPipelineLayout({bindGroupLayouts:[o.frame.layout,o.world.layout,e]}),f=e=>o.device.createComputePipeline({label:`white balance ${e}`,layout:d,compute:{module:u,entryPoint:e}});t=f(`meter`),n=f(`resolve`);let p=GPUBufferUsage;r=o.device.createBuffer({label:`white balance sums`,size:16,usage:p.STORAGE}),i=o.device.createBuffer({label:`white balance state`,size:16,usage:p.STORAGE}),a=o.device.createBuffer({label:`white balance params`,size:16,usage:p.UNIFORM|p.COPY_DST})},resize(e,t){o=null,s=null},encode(d,f,p,m,h){let g=f.gbuf.views;(!o||!s||s.gi!==g.giDiffuse||s.depth!==g.depth||s.exposure!==h)&&(o=f.device.createBindGroup({label:`white balance`,layout:e,entries:[{binding:0,resource:g.normal},{binding:1,resource:g.misc},{binding:2,resource:g.depth},{binding:3,resource:g.sunShadow},{binding:4,resource:g.giDiffuse},{binding:5,resource:{buffer:a}},{binding:6,resource:{buffer:r}},{binding:7,resource:{buffer:i}},{binding:8,resource:{buffer:h,size:32}}]}),s={gi:g.giDiffuse,depth:g.depth,exposure:h}),l[0]=p.dt,u[1]=+!!m.reset,f.device.queue.writeBuffer(a,0,c);let _=d.beginComputePass({label:`white balance`});_.setBindGroup(0,f.frame.group),_.setBindGroup(1,f.world.group),_.setBindGroup(2,o),_.setPipeline(t);let v=Tt*wt.stride;_.dispatchWorkgroups(Math.ceil(f.gbuf.width/v),Math.ceil(f.gbuf.height/v)),_.setPipeline(n),_.dispatchWorkgroups(1),_.end()},destroy(){r?.destroy(),i?.destroy(),a?.destroy(),o=null,s=null}}}function Ot(e){return e===1||e===2||e===3?e:0}function kt(e,t,n){return e===1?n:t}function At(e,t){return t===e||t===e+1}function jt(e,t){let n=Math.abs(e[0]*t[0]+e[1]*t[1]+e[2]*t[2]+e[3]*t[3]);return 2*Math.acos(Math.min(n,1))}function Mt(e,t,n,r){return Math.hypot(n[0]-e[0],n[1]-e[1],n[2]-e[2])>30||jt(t,r)>2}function Nt(){let e=!0,t=-1,n=!1,r=[0,0,0],i=[0,0,0,1];return{invalidate(){e=!0},step(a,o,s){let c=e||!At(t,a)||Mt(r,i,o,s);return n=!e&&a===t,e=!1,t=a,r[0]=o[0],r[1]=o[1],r[2]=o[2],i[0]=s[0],i[1]=s[1],i[2]=s[2],i[3]=s[3],c},get repeated(){return n}}}function Pt(){let e=mt(),t=Ct(),n=lt(),r=Dt(),i=Se(),a=je(),o=Nt(),s={reset:!0,taa:!0,bloom:!0},c={outWidth:0,outHeight:0,preExposure:1,prevPreExposure:1},l={},u=0,d=0,f=0;return{init(o){e.init(o),t.init(o),n.init(o),r.init(o),i.init(o),a.init(o)},resize(s,c){e.resize(s,c),t.resize(s,c),n.resize(s,c),r.resize(s,c),i.resize(s,c),a.resize(s,c),(c.width!==d||c.height!==f)&&o.invalidate(),d=c.width,f=c.height},resetHistory(){o.invalidate()},update(e,t){a.update(e,t)},encode(d,f,p,m,h){s.reset=o.step(p.frameIndex,p.camera.pos,p.camera.quat),s.taa=f.quality.taa,s.bloom=f.quality.bloom,c.outWidth=h.outWidth,c.outHeight=h.outHeight,c.preExposure=h.preExposure,c.prevPreExposure=o.repeated?h.preExposure:h.prevPreExposure,e.encode(d,f,p,c,s),t.encode(d,f,p,c,s,e.output),n.encode(d,f,p,c,s,t.resolved),r.encode(d,f,p,s,n.ratio),i.encode(d,f,p,c,s,t.resolved),l.resolved=kt(u,t.resolved,f.gbuf.views.hdr),l.bloom=i.output,l.exposure=n.ratio,l.target=m,l.debug=u,a.encode(d,f,p,c,l)},setDebug(e){u=Ot(e)},getStats(){return n.getStats()},debugTextures(){return{resolved:t.resolvedTexture,bloom:i.outputTexture}},destroy(){e.destroy(),t.destroy(),n.destroy(),r.destroy(),i.destroy(),a.destroy()}}}var Ft={depth:`depth32float`,gAlbedo:`rgba8unorm`,gNormal:`rgba16float`,gMisc:`rgba8unorm`,gMotion:`rg16float`,hdr:`rgba16float`,giDiffuse:`rgba16float`,giSpecular:`rgba16float`,sunShadow:`r32float`},It=[{format:Ft.gAlbedo},{format:Ft.gNormal},{format:Ft.gMisc},{format:Ft.gMotion}],Lt={format:Ft.depth,depthWriteEnabled:!0,depthCompare:`greater`},Rt={format:Ft.depth,depthWriteEnabled:!1,depthCompare:`equal`},zt={format:Ft.depth,depthWriteEnabled:!1,depthCompare:`greater`},Bt=2e4,Vt={grassBladesPerM2:1300,grassDistance:600,detailOctaves:7,cloudSteps:160};function Ht(e){return(typeof e==`string`?e:e.tier)===`extreme`}function Ut(e,t=e.ultra){return{...e,extreme:t}}function Wt(e){switch(e){case`extreme`:return{...Wt(`ultra`),...Vt,tier:e};case`low`:return{tier:e,rtDivisor:4,giRays:1,rtMaxSteps:48,rtSpecular:!1,probes:{dim:[16,8,16],raysPerProbe:32,spacing:8},grassBladesPerM2:60,grassDistance:35,terrainViewDistance:1500,cloudSteps:16,bloom:!1,taa:!0,detailOctaves:2};case`medium`:return{tier:e,rtDivisor:2,giRays:1,rtMaxSteps:64,rtSpecular:!1,probes:{dim:[24,12,24],raysPerProbe:48,spacing:6},grassBladesPerM2:150,grassDistance:55,terrainViewDistance:2500,cloudSteps:24,bloom:!0,taa:!0,detailOctaves:3};case`high`:return{tier:e,rtDivisor:2,giRays:2,rtMaxSteps:96,rtSpecular:!0,probes:{dim:[32,16,32],raysPerProbe:64,spacing:5},grassBladesPerM2:400,grassDistance:80,terrainViewDistance:3500,cloudSteps:32,bloom:!0,taa:!0,detailOctaves:4};case`ultra`:return{tier:e,rtDivisor:2,giRays:2,rtMaxSteps:128,rtSpecular:!0,probes:{dim:[48,24,48],raysPerProbe:96,spacing:4},grassBladesPerM2:900,grassDistance:180,terrainViewDistance:5e3,cloudSteps:64,bloom:!0,taa:!0,detailOctaves:5}}}var Gt=[`timestamp-query`,`float32-filterable`,`indirect-first-instance`,`shader-f16`,`texture-compression-bc`],Kt=[`maxStorageBufferBindingSize`,`maxBufferSize`,`maxUniformBufferBindingSize`,`maxTextureDimension2D`,`maxTextureDimension3D`,`maxStorageBuffersPerShaderStage`,`maxStorageTexturesPerShaderStage`,`maxSampledTexturesPerShaderStage`,`maxComputeWorkgroupStorageSize`,`maxComputeInvocationsPerWorkgroup`,`maxComputeWorkgroupSizeX`,`maxComputeWorkgroupSizeY`,`maxComputeWorkgroupsPerDimension`,`maxBindGroups`,`maxColorAttachmentBytesPerSample`],qt=class extends Error{kind;constructor(e,t,n){super(t,n),this.kind=e,this.name=`GpuInitError`}};function Jt(e,t){console.error(t),e.length<20&&e.push(t)}var Yt=/swiftshader|llvmpipe|softpipe|software|\bwarp\b|microsoft basic render/i;function Xt(e,t=!1){return t||Yt.test(`${e.vendor} ${e.architecture} ${e.description}`)}async function Zt(e){let t=e.requestAdapterInfo,n=e.info??(t?await t.call(e):{}),r=e=>typeof e==`string`?e:``,i={vendor:r(n.vendor),architecture:r(n.architecture),device:r(n.device),description:r(n.description),software:!1};return i.software=Xt(i,(n.isFallbackAdapter??e.isFallbackAdapter)===!0),i}function Qt(e){let t=[e.vendor,e.architecture,e.description].filter(e=>e.length>0);return t.length?t.join(` `):`unknown adapter`}async function $t(){let e=null;try{e=await navigator.gpu.requestAdapter({powerPreference:`high-performance`}),e??=await navigator.gpu.requestAdapter()}catch(e){throw new qt(`no-adapter`,`requestAdapter failed: ${e?.message??e}`,{cause:e})}if(!e)throw new qt(`no-adapter`,`The browser has WebGPU but found no usable graphics adapter.`);return e}async function en(){if(typeof navigator>`u`||!navigator.gpu)throw new qt(`no-webgpu`,`WebGPU is not available in this browser.`);let e=await $t(),t=Gt.filter(t=>e.features.has(t)),n={},r=e.limits;for(let e of Kt)typeof r[e]==`number`&&(n[e]=r[e]);let i;try{i=await e.requestDevice({requiredFeatures:t,requiredLimits:n})}catch(e){throw new qt(`device-request`,`requestDevice failed: ${e?.message??e}`,{cause:e})}let a=await Zt(e);return{device:i,features:new Set(t),adapterName:Qt(a),adapter:a}}var tn=[1,.9,.8,.7,.6,.5,.42],nn=6,rn=120,an=1.02,on=.85,sn=1.3,cn=90,ln=.15,un=1.6,dn=20,fn=30,pn=4e3,mn=4,hn=3e3,gn=8e3,_n=5,vn=3e5,yn=6,bn=3,xn=1e3,Sn=100,Cn=250,wn=12,Tn=class{size;buf;n=0;head=0;sum=0;constructor(e){this.size=e,this.buf=new Float64Array(e)}push(e){this.n===this.size?this.sum-=this.buf[this.head]:this.n++,this.buf[this.head]=e,this.sum+=e,this.head=(this.head+1)%this.size}get full(){return this.n===this.size}get mean(){return this.n?this.sum/this.n:0}clear(){this.n=0,this.head=0,this.sum=0}},En=class{minima=new Float64Array(wn).fill(1/0);scratch=new Float64Array(wn);bucket=0;bucketMs=0;est=0;get periodMs(){return this.est}push(e){if(e>Sn||e<=0||(e<this.minima[this.bucket]&&(this.minima[this.bucket]=e),this.bucketMs+=e,this.bucketMs<Cn))return;this.bucketMs=0;let t=0;for(let e=0;e<wn;e++)this.minima[e]!==1/0&&(this.scratch[t++]=this.minima[e]);let n=this.scratch.subarray(0,t).sort()[t>>1];this.est=this.est===0?n:this.est+(n-this.est)*.2,this.bucket=(this.bucket+1)%wn,this.minima[this.bucket]=1/0}};function Dn(e,t,n){let r=e>0?e:t>0?t:60;return n>0&&(r=Math.min(r,n)),r}var On=class{index=0;clock=0;sinceChangeFrames=0;sinceChangeMs=0;lastChangeMs=0;lastUpMs=-1/0;cleanMs=0;failDoublings=0;usingGpu=!1;measuredPeriodMs=0;missCount=0;missHead=0;missFill=0;misses=new Uint8Array(cn);failedAt=new Float64Array(tn.length).fill(-1/0);fast=new Tn(nn);slow=new Tn(rn);display=new En;get scale(){return tn[this.index]}get stepIndex(){return this.index}get displayPeriodMs(){let e=this.display.periodMs;return this.measuredPeriodMs<=0?e:e>0?Math.min(this.measuredPeriodMs,e):this.measuredPeriodMs}setMeasuredRefreshHz(e){this.measuredPeriodMs=e>0?1e3/e:0}get gpuDriven(){return this.usingGpu}budgetMs(e){return Math.max(1e3/Math.max(e,1),this.displayPeriodMs)}reset(){this.index=0,this.lastUpMs=-1/0,this.failDoublings=0,this.failedAt.fill(-1/0),this.lastChangeMs=this.clock,this.clearWindows()}update(e,t,n,r){if(!r)return this.index!==0&&this.reset(),1;if(!(t>0))return this.scale;let i=Math.min(t,xn);this.clock+=i,this.display.push(t);let a=e!==null&&e>0;a!==this.usingGpu&&(this.usingGpu=a,this.clearWindows()),this.sinceChangeFrames++,this.sinceChangeMs+=i;let o=this.budgetMs(n);return this.clock-this.lastChangeMs>=vn&&(this.failDoublings=0),a?this.updateGpu(Math.min(e,xn),o):this.updateFrameTime(t,i,o),this.scale}updateGpu(e,t){this.fast.push(e),this.slow.push(e);let n=tn.length-1;if(this.index<n&&this.settled(dn)&&this.fast.full&&this.fast.mean>t*an){this.stepDown(this.fast.mean>t*un?2:1);return}if(this.index===0||!this.slow.full||!this.upAllowed())return;let r=tn[this.index-1]/tn[this.index];this.slow.mean*r*r<t*on&&this.stepUp()}settled(e){return this.sinceChangeFrames>=e||this.sinceChangeMs>=pn&&this.sinceChangeFrames>=mn}updateFrameTime(e,t,n){let r=+(e>n*sn);this.missFill===cn?this.missCount-=this.misses[this.missHead]:this.missFill++,this.misses[this.missHead]=r,this.missCount+=r,this.missHead=(this.missHead+1)%cn,this.cleanMs=r?0:this.cleanMs+t;let i=this.missCount/this.missFill,a=tn.length-1,o=this.clock-this.lastUpMs<gn&&this.sinceChangeFrames>=yn&&this.missCount>=bn;if(this.index<a&&(o||this.settled(fn)&&i>ln)){this.stepDown(i>.5?2:1);return}this.index>0&&this.cleanMs>=hn*(1<<this.failDoublings)&&this.upAllowed()&&this.stepUp()}upAllowed(){return this.clock-this.lastUpMs>=hn&&this.clock-this.failedAt[this.index-1]>=gn*(1<<this.failDoublings)}stepDown(e){let t=this.index,n=this.clock-this.lastUpMs<gn;this.failedAt[t]=this.clock,n&&this.failDoublings<_n&&this.failDoublings++,this.index=Math.min(tn.length-1,t+e),this.changed()}stepUp(){this.index--,this.lastUpMs=this.clock,this.changed()}changed(){this.lastChangeMs=this.clock,this.clearWindows()}clearWindows(){this.sinceChangeFrames=0,this.sinceChangeMs=0,this.cleanMs=0,this.fast.clear(),this.slow.clear(),this.misses.fill(0),this.missCount=0,this.missHead=0,this.missFill=0}};function kn(e,t,n){let r=Math.round(e*t*n);return Math.max(64,r+(r&1))}var An={angleRad:Math.PI/180,luminanceEv:2},jn=(e,t)=>{let n=(e[0]*t[0]+e[1]*t[1]+e[2]*t[2])/(Math.hypot(e[0],e[1],e[2])*Math.hypot(t[0],t[1],t[2])||1);return Math.acos(Math.min(1,Math.max(-1,n)))},Mn=class{sun=[0,0,0];moon=[0,0,0];logLum=0;primed=!1;step(e,t){let n=Math.log2(He(e,t)),r=this.primed&&(jn(this.sun,e.sunDir)>An.angleRad||jn(this.moon,e.moonDir)>An.angleRad||Math.abs(n-this.logLum)>An.luminanceEv);for(let t=0;t<3;t++)this.sun[t]=e.sunDir[t],this.moon[t]=e.moonDir[t];return this.logLum=n,this.primed=!0,r}},Nn=[`pre`,`gbuffer`,`rt`,`lighting`,`sky+fwd`,`post`],Pn=[`rtAux`,`probes`,`shadowRays`,`shadowDenoise`,`giRays`,`giDenoise`,`specularRays`,`specularDenoise`,`rtLatch`,`clouds`],Fn=Nn.length+1,In=3,Ln={FrameBegin:0,PreEnd:1,GBufferEnd:2,RtEnd:3,LightingEnd:4,OverlayEnd:5,FrameEnd:6},Rn=class{gpuMs=null;rtMs=null;passMs=Nn.map(()=>NaN);detailed;querySet=null;resolveBuffer=null;readback=[];busy=[];inFlight=new Set;count;bytes;pending=-1;pendingSample=null;disposed=!1;sequence=0;latestSequence=-1;frameIndex=-1;capture=!1;marks=0;details=0;listener=null;constructor(e,t,n=!1){if(this.detailed=t&&n,this.count=Fn+(this.detailed?Pn.length*2:0),this.bytes=this.count*8,t){this.querySet=e.createQuerySet({label:`frame timestamps`,type:`timestamp`,count:this.count}),this.resolveBuffer=e.createBuffer({label:`timestamp resolve`,size:this.bytes,usage:GPUBufferUsage.QUERY_RESOLVE|GPUBufferUsage.COPY_SRC});for(let t=0;t<In;t++)this.readback.push(e.createBuffer({label:`timestamp readback ${t}`,size:this.bytes,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST})),this.busy.push(!1)}}get enabled(){return this.querySet!==null&&!this.disposed}get active(){return this.enabled&&this.detailed&&!this.capture}listen(e){return this.listener=e,()=>{this.listener===e&&(this.listener=null)}}beginFrame(e,t=!1){this.abortFrame(),this.frameIndex=e,this.capture=t,this.marks=0,this.details=0}computePass(e,t){if(!this.active)return{label:e};let n=Pn.indexOf(t);return this.details|=1<<n,{label:e,timestampWrites:{querySet:this.querySet,beginningOfPassWriteIndex:Fn+2*n,endOfPassWriteIndex:Fn+2*n+1}}}mark(e,t){this.enabled&&(this.marks|=1<<t,e.beginComputePass({timestampWrites:{querySet:this.querySet,endOfPassWriteIndex:t}}).end())}resolve(e){if(!this.enabled||!this.resolveBuffer)return;this.mark(e,Ln.FrameEnd);let t={sequence:this.sequence++,frameIndex:this.frameIndex,capture:this.capture,marks:this.marks,details:this.details,listener:this.listener};if(this.pending=this.busy.indexOf(!1),this.pending<0){this.publish(t,`dropped`);return}this.busy[this.pending]=!0,this.pendingSample=t,e.resolveQuerySet(this.querySet,0,this.count,this.resolveBuffer,0),e.copyBufferToBuffer(this.resolveBuffer,0,this.readback[this.pending],0,this.bytes)}afterSubmit(){let e=this.pending,t=this.pendingSample;if(e<0||!t)return;this.pending=-1,this.pendingSample=null;let n=this.readback[e],r;r=Promise.resolve().then(()=>n.mapAsync(GPUMapMode.READ)).then(()=>{try{if(this.disposed)return;let e=new BigUint64Array(n.getMappedRange().slice(0));this.store(e,t)}finally{this.disposed||n.unmap()}}).catch(()=>{this.disposed||this.publish(t,`failed`)}).finally(()=>{this.busy[e]=!1,this.inFlight.delete(r)}),this.inFlight.add(r)}abortFrame(){this.pending>=0&&(this.busy[this.pending]=!1,this.pendingSample&&this.publish(this.pendingSample,`failed`)),this.pending=-1,this.pendingSample=null}async drain(e=5e3){let t=[...this.inFlight];if(!t.length)return!0;let n;try{return await Promise.race([Promise.all(t).then(()=>!0),new Promise(t=>{n=setTimeout(()=>t(!1),Math.max(0,e))})])}finally{n!==void 0&&clearTimeout(n)}}destroy(){if(!this.disposed){this.disposed=!0,this.listener=null,this.pending=-1,this.pendingSample=null,this.querySet?.destroy(),this.resolveBuffer?.destroy();for(let e of this.readback)e.destroy()}}publish(e,t){!e.capture&&!this.disposed&&this.deliver(e.listener,{sequence:e.sequence,frameIndex:e.frameIndex,status:t,gpuMs:null,passMs:[],detailMs:null,detailWritten:e.details})}deliver(e,t){try{e?.(t)}catch(e){console.warn(`GPU timing listener failed`,e)}}store(e,t){if(t.capture&&this.detailed)return;let n=(n,r)=>t.marks&1<<n&&t.marks&1<<r?zn(e,n,r):null;if(t.sequence>this.latestSequence){this.latestSequence=t.sequence,this.gpuMs=Bn(e,Ln.FrameBegin,Ln.FrameEnd),this.rtMs=Bn(e,Ln.GBufferEnd,Ln.RtEnd);for(let t=0;t<Nn.length;t++)this.passMs[t]=Bn(e,t,t+1)??NaN}if(!t.listener||t.capture)return;let r=n(Ln.FrameBegin,Ln.FrameEnd),i=Nn.map((e,t)=>n(t,t+1)??NaN),a=this.detailed?Object.fromEntries(Pn.map((n,r)=>[n,t.details&1<<r?zn(e,Fn+2*r,Fn+2*r+1):null])):null;this.deliver(t.listener,{sequence:t.sequence,frameIndex:t.frameIndex,status:`measured`,gpuMs:r,passMs:i,detailMs:a,detailWritten:t.details})}};function zn(e,t,n){return e[t]>0n&&e[n]>=e[t]?Number(e[n]-e[t])/1e6:null}function Bn(e,t,n){return e[n]>e[t]&&e[t]>0n?Number(e[n]-e[t])/1e6:null}var Vn=[.5,1,1,0],Hn=[0,0,0,0],Un=class{gbufferPass;skyPass;forwardPass;overlayPass;width=0;height=0;bind(e){let t=e.views;this.width=e.width,this.height=e.height;let n=(e,t)=>({view:e,clearValue:t,loadOp:`clear`,storeOp:`store`});this.gbufferPass={label:`gbuffer`,colorAttachments:[n(t.albedo,[0,0,0,1]),n(t.normal,Vn),n(t.misc,[0,0,0,0]),n(t.motion,[0,0,0,0])],depthStencilAttachment:{view:t.depth,depthClearValue:0,depthLoadOp:`clear`,depthStoreOp:`store`}};let r=e=>({label:e,colorAttachments:[{view:t.hdr,loadOp:`load`,storeOp:`store`}],depthStencilAttachment:{view:t.depth,depthReadOnly:!0}});this.skyPass=r(`sky`),this.forwardPass=r(`forward`),this.overlayPass=r(`sky + forward`)}encode(e,t,n,r,i,a,o,s,c){a.mark(e,Ln.FrameBegin),n.encodePre(e,t,o),a.mark(e,Ln.PreEnd);let l=e.beginRenderPass(this.gbufferPass);if(this.bindShared(l,t),n.encodeGBuffer(l,t,o),l.end(),a.mark(e,Ln.GBufferEnd),n.tracesRays&&n.encodeRT(e,t,o),a.mark(e,Ln.RtEnd),r.encode(e),a.mark(e,Ln.LightingEnd),n.drawsSky&&n.drawsForward&&n.sharedOverlayPass){let r=e.beginRenderPass(this.overlayPass);this.bindShared(r,t),n.encodeSky(r,t,o),r.setViewport(0,0,this.width,this.height,0,1),r.setScissorRect(0,0,this.width,this.height),r.setBlendConstant(Hn),r.setStencilReference(0),this.bindShared(r,t),n.encodeForward(r,t,o),r.end()}else{if(n.drawsSky){let r=e.beginRenderPass(this.skyPass);this.bindShared(r,t),n.encodeSky(r,t,o),r.end()}if(n.drawsForward){let r=e.beginRenderPass(this.forwardPass);this.bindShared(r,t),n.encodeForward(r,t,o),r.end()}}a.mark(e,Ln.OverlayEnd),i.encode(e,t,o,s,c)}bindShared(e,t){e.setBindGroup(0,t.frame.group),e.setBindGroup(1,t.world.group)}};function Wn(e){for(let t=0;t<16;t++)e[t]=+(t%5==0);return e}function Gn(e,t,n){for(let r=0;r<4;r++){let i=n[r*4],a=n[r*4+1],o=n[r*4+2],s=n[r*4+3];e[r*4]=t[0]*i+t[4]*a+t[8]*o+t[12]*s,e[r*4+1]=t[1]*i+t[5]*a+t[9]*o+t[13]*s,e[r*4+2]=t[2]*i+t[6]*a+t[10]*o+t[14]*s,e[r*4+3]=t[3]*i+t[7]*a+t[11]*o+t[15]*s}return e}function Kn(e,t){let n=t[0],r=t[1],i=t[2],a=t[3],o=t[4],s=t[5],c=t[6],l=t[7],u=t[8],d=t[9],f=t[10],p=t[11],m=t[12],h=t[13],g=t[14],_=t[15],v=n*s-r*o,y=n*c-i*o,b=n*l-a*o,x=r*c-i*s,S=r*l-a*s,C=i*l-a*c,w=u*h-d*m,T=u*g-f*m,E=u*_-p*m,D=d*g-f*h,O=d*_-p*h,k=f*_-p*g,A=v*k-y*O+b*D+x*E-S*T+C*w;return A?(A=1/A,e[0]=(s*k-c*O+l*D)*A,e[1]=(i*O-r*k-a*D)*A,e[2]=(h*C-g*S+_*x)*A,e[3]=(f*S-d*C-p*x)*A,e[4]=(c*E-o*k-l*T)*A,e[5]=(n*k-i*E+a*T)*A,e[6]=(g*b-m*C-_*y)*A,e[7]=(u*C-f*b+p*y)*A,e[8]=(o*O-s*E+l*w)*A,e[9]=(r*E-n*O-a*w)*A,e[10]=(m*S-h*b+_*v)*A,e[11]=(d*b-u*S-p*v)*A,e[12]=(s*T-o*D-c*w)*A,e[13]=(n*D-r*T+i*w)*A,e[14]=(h*y-m*x-g*v)*A,e[15]=(u*x-d*y+f*v)*A,!0):(Wn(e),!1)}function qn(e,t,n,r){let i=1/Math.tan(t*.5);for(let t=0;t<16;t++)e[t]=0;return e[0]=i/n,e[5]=i,e[11]=-1,e[14]=r,e}function Jn(e,t,n,r,i,a,o,s){let c=1/(Math.hypot(i,a,o,s)||1);i*=c,a*=c,o*=c,s*=c;let l=i*i,u=a*a,d=o*o,f=i*a,p=i*o,m=a*o,h=s*i,g=s*a,_=s*o,v=1-2*(u+d),y=2*(f-_),b=2*(p+g),x=2*(f+_),S=1-2*(l+d),C=2*(m-h),w=2*(p-g),T=2*(m+h),E=1-2*(l+u);return e[0]=v,e[1]=y,e[2]=b,e[3]=0,e[4]=x,e[5]=S,e[6]=C,e[7]=0,e[8]=w,e[9]=T,e[10]=E,e[11]=0,e[12]=-(v*t+x*n+w*r),e[13]=-(y*t+S*n+T*r),e[14]=-(b*t+C*n+E*r),e[15]=1,e}function Yn(e,t,n,r,i,a,o,s){let c=1/(Math.hypot(i,a,o,s)||1);i*=c,a*=c,o*=c,s*=c;let l=i*i,u=a*a,d=o*o,f=i*a,p=i*o,m=a*o,h=s*i,g=s*a,_=s*o;return e[0]=1-2*(u+d),e[1]=2*(f+_),e[2]=2*(p-g),e[3]=0,e[4]=2*(f-_),e[5]=1-2*(l+d),e[6]=2*(m+h),e[7]=0,e[8]=2*(p+g),e[9]=2*(m-h),e[10]=1-2*(l+u),e[11]=0,e[12]=t,e[13]=n,e[14]=r,e[15]=1,e}var Xn={view:0,proj:16,viewProj:32,viewProjUnjittered:48,invView:64,invProj:80,invViewProj:96,prevViewProj:112,celestial:128,camPos:144,screen:148,jitter:152,sunDir:156,sunIrradiance:160,moonDir:164,moonIrradiance:168,terrain:172,terrainOrigin:176,misc:180,params:184,sky:188},Zn=.00465,Qn=.0045,$n=-.0145,er=-.0145,tr=1.25,nr=[.86,1,1.16],rr=.2126*nr[0]+.7152*nr[1]+.0722*nr[2],ir=[nr[0]/rr,nr[1]/rr,nr[2]/rr];function ar(e,t){let n=1,r=0;for(;e>0;)n/=t,r+=e%t*n,e=Math.floor(e/t);return r}function or(e,t,n,r,i=0){let a=e%16+1;r[i]=(ar(a,2)-.5)*2/t,r[i+1]=(ar(a,3)-.5)*2/n}function sr(e){let t=Math.imul(e>>>0,747796405)+2891336453>>>0,n=Math.imul((t>>>(t>>>28)+4^t)>>>0,277803737)>>>0;return(n>>>22^n)>>>0}var cr=class{buffer=new ArrayBuffer(768);f32=new Float32Array(this.buffer);u32=new Uint32Array(this.buffer);view=new Float32Array(16);proj=new Float32Array(16);projUnjit=new Float32Array(16);viewProj=new Float32Array(16);viewProjUnjit=new Float32Array(16);world=new Float32Array(16);invProj=new Float32Array(16);invViewProj=new Float32Array(16);prevViewProj=new Float32Array(16);jitterCur=new Float32Array(2);jitterPrev=new Float32Array(2);havePrev=!1;key=0;get keyLight(){return this.key}resetHistory(){this.havePrev=!1}write(e){let{camera:t,astro:n}=e,r=this.f32,i=this.u32,a=Xn;Jn(this.view,t.pos[0],t.pos[1],t.pos[2],t.quat[0],t.quat[1],t.quat[2],t.quat[3]),Yn(this.world,t.pos[0],t.pos[1],t.pos[2],t.quat[0],t.quat[1],t.quat[2],t.quat[3]);let o=t.near>0?t.near:.05,s=e.width/Math.max(e.height,1);qn(this.projUnjit,t.fovY,s,o),this.proj.set(this.projUnjit),this.jitterPrev[0]=this.jitterCur[0],this.jitterPrev[1]=this.jitterCur[1],e.jitter?or(e.frameIndex,e.width,e.height,this.jitterCur):(this.jitterCur[0]=0,this.jitterCur[1]=0),this.proj[8]=-this.jitterCur[0],this.proj[9]=-this.jitterCur[1],Gn(this.viewProj,this.proj,this.view),Gn(this.viewProjUnjit,this.projUnjit,this.view),Kn(this.invProj,this.proj),Kn(this.invViewProj,this.viewProj),this.havePrev||=(this.prevViewProj.set(this.viewProjUnjit),this.jitterPrev.set(this.jitterCur),!0),r.set(this.view,a.view),r.set(this.proj,a.proj),r.set(this.viewProj,a.viewProj),r.set(this.viewProjUnjit,a.viewProjUnjittered),r.set(this.world,a.invView),r.set(this.invProj,a.invProj),r.set(this.invViewProj,a.invViewProj),r.set(this.prevViewProj,a.prevViewProj),this.writeCelestial(n.equatorialToWorld),this.prevViewProj.set(this.viewProjUnjit),r[a.camPos]=t.pos[0],r[a.camPos+1]=t.pos[1],r[a.camPos+2]=t.pos[2],r[a.camPos+3]=e.time,r[a.screen]=e.width,r[a.screen+1]=e.height,r[a.screen+2]=1/e.width,r[a.screen+3]=1/e.height,r[a.jitter]=this.jitterCur[0],r[a.jitter+1]=this.jitterCur[1],r[a.jitter+2]=this.jitterPrev[0],r[a.jitter+3]=this.jitterPrev[1],this.writeLights(n);let c=e.terrain;if(c){let e=c.resolution*c.cellSize;r[a.terrain]=c.resolution,r[a.terrain+1]=c.cellSize,r[a.terrain+2]=c.minHeight,r[a.terrain+3]=c.maxHeight,r[a.terrainOrigin]=c.origin[0],r[a.terrainOrigin+1]=c.origin[1],r[a.terrainOrigin+2]=e,r[a.terrainOrigin+3]=e}else r.fill(0,a.terrain,a.terrain+8),r[a.terrain]=1,r[a.terrain+1]=1;i[a.misc]=e.frameIndex>>>0,i[a.misc+1]=e.qualityFlags>>>0,i[a.misc+2]=sr(e.frameIndex),i[a.misc+3]=this.key,r[a.params]=e.dt,r[a.params+1]=e.preExposure,r[a.params+2]=o,r[a.params+3]=0,r[a.sky]=6360,r[a.sky+1]=6460,r[a.sky+2]=Math.max(1e-4,t.pos[1]/1e3+e.observerAltitudeM/1e3),r[a.sky+3]=1}writeCelestial(e){let t=this.f32,n=Xn.celestial;t.fill(0,n,n+16);for(let r=0;r<3;r++)for(let i=0;i<3;i++)t[n+r*4+i]=e[i*3+r];t[n+15]=1}writeLights(e){let t=this.f32,n=Xn,r=e.sunDir,i=e.moonDir;t[n.sunDir]=r[0],t[n.sunDir+1]=r[1],t[n.sunDir+2]=r[2],t[n.sunDir+3]=Zn,t[n.moonDir]=i[0],t[n.moonDir+1]=i[1],t[n.moonDir+2]=i[2],t[n.moonDir+3]=Qn;let a=e.sunElevation>$n,o=e.moonElevation>er;t[n.sunIrradiance]=Me,t[n.sunIrradiance+1]=Me,t[n.sunIrradiance+2]=Me,t[n.sunIrradiance+3]=+!!a;let s=Le(e.moonPhaseAngle);t[n.moonIrradiance]=s*ir[0],t[n.moonIrradiance+1]=s*ir[1],t[n.moonIrradiance+2]=s*ir[2],t[n.moonIrradiance+3]=e.moonIlluminatedFraction;let c=a?Me*Math.max(r[1],0):0,l=o?s*Math.max(i[1],0):0;this.key===0&&l>c*tr?this.key=1:this.key===1&&c>l*tr&&(this.key=0)}};function lr(e,t,n,r){return{width:kn(e,n,r),height:kn(t,n,r)}}function ur(e,t,n){return{width:Math.ceil(e/n),height:Math.ceil(t/n)}}var dr=[`depth`,`albedo`,`normal`,`misc`,`motion`,`hdr`,`giDiffuse`,`giSpecular`,`sunShadow`];function fr(e,t,n,r){let i=ur(t,n,r),a=GPUTextureUsage,o=a.RENDER_ATTACHMENT|a.TEXTURE_BINDING|a.COPY_SRC,s=a.STORAGE_BINDING|a.TEXTURE_BINDING|a.COPY_SRC,c=(t,n,r,i,a)=>e.createTexture({label:t,format:n,size:[r,i],usage:a}),l={depth:c(`gDepth`,Ft.depth,t,n,o),albedo:c(`gAlbedo`,Ft.gAlbedo,t,n,o),normal:c(`gNormal`,Ft.gNormal,t,n,o),misc:c(`gMisc`,Ft.gMisc,t,n,o),motion:c(`gMotion`,Ft.gMotion,t,n,o),hdr:c(`hdr`,Ft.hdr,t,n,o|a.STORAGE_BINDING),giDiffuse:c(`giDiffuse`,Ft.giDiffuse,i.width,i.height,s|a.RENDER_ATTACHMENT),giSpecular:c(`giSpecular`,Ft.giSpecular,i.width,i.height,s|a.RENDER_ATTACHMENT),sunShadow:c(`sunShadow`,Ft.sunShadow,i.width,i.height,s|a.RENDER_ATTACHMENT)},u={};for(let e of dr)u[e]=l[e].createView(e===`depth`?{aspect:`depth-only`}:void 0);return pr(e,u.sunShadow),{width:t,height:n,...l,rtWidth:i.width,rtHeight:i.height,views:u}}function pr(e,t){let n=e.createCommandEncoder({label:`sunShadow clear`});n.beginRenderPass({colorAttachments:[{view:t,clearValue:[1,1,1,1],loadOp:`clear`,storeOp:`store`}]}).end(),e.queue.submit([n.finish()])}function mr(e){for(let t of dr)e[t].destroy()}var hr=class{device;buffer;roots=new Uint32Array([4294967295,4294967295]);constructor(e){this.device=e,this.buffer=e.createBuffer({label:`park lights, rooms and spatial bins`,size:4194304,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}),this.setScene()}setScene(e){let t=e?.lights??[],n=e?.rooms??[],r=Array.from({length:4096},()=>[]);t.forEach((e,t)=>{let n=Math.max(0,Math.floor((e.pos[0]-e.radius+1024)/32)),i=Math.min(63,Math.floor((e.pos[0]+e.radius+1024)/32)),a=Math.max(0,Math.floor((e.pos[2]-e.radius+1024)/32)),o=Math.min(63,Math.floor((e.pos[2]+e.radius+1024)/32));for(let e=a;e<=o;e++)for(let a=n;a<=i;a++)r[e*64+a].push(t)});let i=4+t.length*8+n.length*8,a=i+16384,o=r.reduce((e,t)=>e+t.length,0),s=new ArrayBuffer((a+Math.ceil(o/4)*4)*4),c=new Float32Array(s),l=new Uint32Array(s);if(s.byteLength>this.buffer.size)throw Error(`Park light spatial index exceeds its buffer`);l.set([t.length,n.length,4294967295,4294967295]),t.forEach((e,t)=>c.set([...e.pos,e.candela,...e.color,e.radius],4+t*8)),n.forEach((e,n)=>c.set([...e.min,0,...e.max,0],4+t.length*8+n*8));let u=0;r.forEach((e,t)=>{l[i+t*4]=u,l[i+t*4+1]=e.length,l.set(e,a+u),u+=e.length}),this.device.queue.writeBuffer(this.buffer,0,l)}setRoots(e,t){this.roots[0]=e,this.roots[1]=t,this.device.queue.writeBuffer(this.buffer,8,this.roots)}destroy(){this.buffer.destroy()}},gr=8,_r=class{rc;pipeline;layout;group=null;width=0;height=0;generation=-1;empty;constructor(e,t){this.rc=e;let n=GPUShaderStage.COMPUTE;e.parkLights??=new hr(e.device),this.empty=e.device.createBuffer({label:`empty lighting geometry`,size:64,usage:GPUBufferUsage.STORAGE});let r=(e,t)=>({binding:e,visibility:n,texture:{sampleType:t}});this.layout=e.device.createBindGroupLayout({label:`lighting`,entries:[r(0,`float`),r(1,`float`),r(2,`float`),r(3,`depth`),r(4,`unfilterable-float`),r(5,`float`),r(6,`float`),{binding:7,visibility:n,storageTexture:{access:`write-only`,format:`rgba16float`}},...[8,9,10].map(e=>({binding:e,visibility:n,buffer:{type:`read-only-storage`}}))]}),this.pipeline=e.device.createComputePipeline({label:`deferred lighting`,layout:e.device.createPipelineLayout({bindGroupLayouts:[e.frame.layout,e.world.layout,this.layout]}),compute:{module:e.module(`lighting/deferred.wgsl`,{FALLBACK_SKY:t}),entryPoint:`main`}}),this.rebuild()}rebuild(){let e=this.rc.gbuf,t=e.views;this.group=this.rc.device.createBindGroup({label:`lighting`,layout:this.layout,entries:[{binding:0,resource:t.albedo},{binding:1,resource:t.normal},{binding:2,resource:t.misc},{binding:3,resource:t.depth},{binding:4,resource:t.sunShadow},{binding:5,resource:t.giDiffuse},{binding:6,resource:t.giSpecular},{binding:7,resource:t.hdr},{binding:8,resource:{buffer:this.rc.parkLights.buffer}},{binding:9,resource:{buffer:this.rc.rtBuffers?.nodes??this.empty}},{binding:10,resource:{buffer:this.rc.rtBuffers?.prims??this.empty}}]}),this.width=e.width,this.height=e.height,this.generation=this.rc.rtBuffers?.generation??-1}setScene(e){this.rc.parkLights.setScene(e)}destroy(){this.empty.destroy(),this.rc.parkLights?.destroy()}encode(e){this.generation!==(this.rc.rtBuffers?.generation??-1)&&this.rebuild();let t=e.beginComputePass({label:`deferred lighting`});t.setPipeline(this.pipeline),t.setBindGroup(0,this.rc.frame.group),t.setBindGroup(1,this.rc.world.group),t.setBindGroup(2,this.group),t.dispatchWorkgroups(Math.ceil(this.width/gr),Math.ceil(this.height/gr)),t.end()}},vr=[`update`,`encodePre`,`encodeGBuffer`,`encodeRT`,`encodeSky`,`encodeForward`],yr=class{candidates;report;modules=[];lists={update:[],encodePre:[],encodeGBuffer:[],encodeRT:[],encodeSky:[],encodeForward:[]};reported=new Set;timings=[];constructor(e,t){this.candidates=e,this.report=t}get drawsSky(){return this.lists.encodeSky.length>0}get drawsForward(){return this.lists.encodeForward.length>0}get sharedOverlayPass(){let e=this.lists.encodeSky,t=this.lists.encodeForward;for(let t=0;t<e.length;t++)if(e[t].sharedOverlayPass!==!0)return!1;for(let e=0;e<t.length;e++)if(t[e].sharedOverlayPass!==!0)return!1;return!0}get tracesRays(){return this.lists.encodeRT.length>0}get names(){return this.modules.map(e=>e.name)}async init(e){for(let t of this.candidates){let n=performance.now();try{await t.init(e),this.timings.push({stage:`${t.name} init`,ms:performance.now()-n})}catch(e){this.fail(t,`init`,e);continue}this.modules.push(t);for(let e of vr)typeof t[e]==`function`&&this.lists[e].push(t)}let t=performance.now();await Promise.all(this.modules.map(async e=>{if(e.ready)try{await e.ready()}catch(t){this.fail(e,`ready`,t)}})),this.timings.push({stage:`background compiles wait`,ms:performance.now()-t})}resize(e){for(let t of this.modules)if(t.resize)try{t.resize(e)}catch(e){this.fail(t,`resize`,e)}}setScene(e,t){for(let n of this.modules){if(!n.setScene)continue;let r=performance.now();try{n.setScene(e,t)}catch(e){this.fail(n,`setScene`,e)}this.timings.push({stage:`${n.name} setScene`,ms:performance.now()-r})}}async replace(e,t,n){for(let r of t){let t=this.modules.findIndex(e=>e.name===r.name);if(t<0)throw Error(`no render module "${r.name}" to replace`);let i=this.modules[t];try{i.destroy?.()}catch(e){this.fail(i,`destroy`,e)}let a=performance.now();if(await r.init(e),await r.ready?.(),this.timings.push({stage:`${r.name} init`,ms:performance.now()-a}),this.modules[t]=r,n&&r.setScene){let t=performance.now();r.setScene(e,n),this.timings.push({stage:`${r.name} setScene`,ms:performance.now()-t})}}for(let e of vr){this.lists[e].length=0;for(let t of this.modules)typeof t[e]==`function`&&this.lists[e].push(t)}}resetLighting(){for(let e of this.modules)if(e.resetLighting)try{e.resetLighting()}catch(t){this.fail(e,`resetLighting`,t)}}update(e,t){let n=this.lists.update;for(let r=0;r<n.length;r++)try{n[r].update(e,t)}catch(e){this.disable(n,r--,`update`,e)}}encodePre(e,t,n){let r=this.lists.encodePre;for(let i=0;i<r.length;i++)try{r[i].encodePre(e,t,n)}catch(e){this.disable(r,i--,`encodePre`,e)}}encodeGBuffer(e,t,n){let r=this.lists.encodeGBuffer;for(let i=0;i<r.length;i++)try{r[i].encodeGBuffer(e,t,n)}catch(e){this.disable(r,i--,`encodeGBuffer`,e)}}encodeRT(e,t,n){let r=this.lists.encodeRT;for(let i=0;i<r.length;i++)try{r[i].encodeRT(e,t,n)}catch(e){this.disable(r,i--,`encodeRT`,e)}}encodeSky(e,t,n){let r=this.lists.encodeSky;for(let i=0;i<r.length;i++)try{r[i].encodeSky(e,t,n)}catch(e){this.disable(r,i--,`encodeSky`,e)}}encodeForward(e,t,n){let r=this.lists.encodeForward;for(let i=0;i<r.length;i++)try{r[i].encodeForward(e,t,n)}catch(e){this.disable(r,i--,`encodeForward`,e)}}destroy(){for(let e of this.modules)try{e.destroy?.()}catch(t){this.fail(e,`destroy`,t)}this.modules.length=0;for(let e of vr)this.lists[e].length=0}disable(e,t,n,r){let[i]=e.splice(t,1);this.fail(i,n,r)}fail(e,t,n){let r=`${e.name}.${t}`;if(this.reported.has(r))return;this.reported.add(r);let i=n instanceof Error?n.stack??n.message:String(n);this.report(`render module "${e.name}" hook ${t} failed and is disabled: ${i}`)}},br=Math.PI/180,xr=(e,t,n,r,i,a,o=0,s=.22)=>({name:e,kind:`mare`,lonDeg:t,latDeg:n,radiusLonDeg:r,radiusLatDeg:i,strength:a,softness:s,rotationDeg:o}),Sr=(e,t,n,r,i)=>({name:e,kind:`crater`,lonDeg:t,latDeg:n,radiusLonDeg:r,radiusLatDeg:r,strength:i,softness:.5,rotationDeg:0}),Cr=[xr(`Mare Imbrium`,-16,33,18.5,16,1),xr(`Mare Serenitatis`,18,28,11.7,11.7,1),xr(`Mare Tranquillitatis`,31,8.5,13.5,11,.95),xr(`Mare Crisium`,59,17,6.9,6.2,1),xr(`Mare Fecunditatis`,51,-8,9.5,14,.85,20),xr(`Mare Nectaris`,34,-15,5.5,5.5,.9),xr(`Oceanus Procellarum`,-57,18,17,24,.8,10,.35),xr(`Mare Nubium`,-17,-21,12,9.5,.85),xr(`Mare Humorum`,-39,-24,6.4,6.4,.95),xr(`Mare Frigoris`,1,56,26.5,4,.7,0,.3),xr(`Mare Vaporum`,3,13,4.2,4.2,.9),xr(`Mare Cognitum`,-23,-10,6.2,5,.85),xr(`Mare Insularum`,-31,7.5,8.5,7,.8),xr(`Sinus Medii`,2,.5,5.5,4.5,.7),xr(`Mare Humboldtianum`,82,57,4.5,4.5,.9),xr(`Mare Marginis`,86,13,6,5,.8),xr(`Mare Smythii`,87,1.3,6,5,.85),xr(`Mare Somniorum`,31,21,6,5,.85),xr(`Sinus Iridum`,-31.5,44,4.2,4.2,.9),xr(`Sinus Aestuum`,-8,12,5,4.5,.85),Sr(`Tycho`,-11.4,-43.4,.9,1),Sr(`Copernicus`,-20.1,9.6,.8,.85),Sr(`Kepler`,-38,8.1,.45,.7),Sr(`Aristarchus`,-47.4,23.7,.5,1),Sr(`Proclus`,46.9,16.1,.35,.8)],wr=Cr.length*2;function Tr(){let e=u;return[[e[0],e[3],e[6]],[e[1],e[4],e[7]],[e[2],e[5],e[8]]]}var Er=6360,Dr=6460,Or=83e-8,kr=[1,.98,.93],Ar=1360,jr={width:256,height:64},Mr={width:192,height:108};Math.sqrt(Dr*Dr-Er*Er);function Nr(e,t){let n=Math.max(180/Math.PI*Math.acos(Math.min(Math.max(e,-1),1)),15),r=45*Math.exp(-(((180-n)/8)**2)),i=140+Ar*(30/n)**2.5+r,a=Math.sqrt(Math.max(1-t*t,0)),o=5+25*Math.exp(-n/35);return 77+(i-77)*a**+o}var Pr=(12+wr)*16,Fr=23.4392911*br,P={flags:0,sky2:4,cloudA:8,cloudB:12,wind:16,cloudC:20,cloudD:24,eclNorth:28,gal0:32,gal1:36,gal2:40,cloudE:44,maria:48};function Ir(e,t,n,r=[0,0]){let i=t*br;return r[0]=Math.sin(i)*e*n,r[1]=-Math.cos(i)*e*n,r}function Lr(e,t=[0,0,0]){let n=-Math.sin(Fr),r=Math.cos(Fr);for(let i=0;i<3;i++)t[i]=e[3*i+1]*n+e[3*i+2]*r;return t}var Rr=[0,0],zr=[0,0],Br=[0,0,0],Vr=class{data=new Float32Array(Pr/4);constructor(){let e=this.data,t=Tr();for(let n=0;n<3;n++){let r=P.gal0+n*4;e[r]=t[n][0],e[r+1]=t[n][1],e[r+2]=t[n][2]}Cr.forEach((t,n)=>{let r=P.maria+n*8;e[r]=t.lonDeg*br,e[r+1]=t.latDeg*br,e[r+2]=t.radiusLonDeg*br,e[r+3]=t.radiusLatDeg*br,e[r+4]=t.strength,e[r+5]=t.softness,e[r+6]=t.rotationDeg*br,e[r+7]=t.kind===`mare`?0:1})}write(e){let t=this.data,n=e.settings;t[P.flags]=+!!e.moonScattering,t[P.flags+1]=n.nightSkyScale,t[P.flags+2]=n.starBrightness,t[P.flags+3]=n.twinkle,t[P.sky2]=n.milkyWayEnabled?n.milkyWayBrightness:0,t[P.sky2+1]=+!!n.starsEnabled,t[P.sky2+2]=+!!n.cloudsEnabled,t[P.sky2+3]=e.starMagLimit,t[P.cloudA]=n.cloudCoverage,t[P.cloudA+1]=n.cirrusCoverage,t[P.cloudA+2]=n.cloudDensity,t[P.cloudA+3]=e.seed,t[P.cloudB]=n.cumulusBaseKm,t[P.cloudB+1]=n.cumulusTopKm,t[P.cloudB+2]=n.cirrusBaseKm,t[P.cloudB+3]=n.cirrusTopKm,Ir(n.windSpeed,n.windDirectionDeg,e.timeSeconds,Rr),Ir(n.windSpeed*1.8,n.windDirectionDeg+15,e.timeSeconds,zr),t[P.wind]=Rr[0],t[P.wind+1]=Rr[1],t[P.wind+2]=zr[0],t[P.wind+3]=zr[1],t[P.cloudC]=e.cloudSteps,t[P.cloudC+1]=e.jitterIndex,t[P.cloudC+2]=e.shadowCenterX,t[P.cloudC+3]=e.shadowCenterZ,t[P.cloudE]=e.cloudDetail??0,t[P.cloudD]=e.historyBlend,t[P.cloudD+1]=+!!e.historyValid,t[P.cloudD+2]=e.lightSteps,t[P.cloudD+3]=e.shadowExtentM,Lr(e.equatorialToWorld,Br),t[P.eclNorth]=Br[0],t[P.eclNorth+1]=Br[1],t[P.eclNorth+2]=Br[2],t[P.eclNorth+3]=(n.windDirectionDeg+15)*br;let r=e.nightDome;return t[P.gal0+3]=r?r[0]:0,t[P.gal1+3]=r?r[1]:0,t[P.gal2+3]=r?r[2]:0,t}},Hr=8e3,Ur=.9,Wr=1.6,Gr=.6,Kr=[24,4,4],qr=32,Jr=12,Yr=1.8,Xr=15,Zr=new Uint32Array(3),Qr=new Float64Array(4),$r=(e,t,n)=>{let r=Math.min(1,Math.max(0,(n-e)/(t-e)));return r*r*(3-2*r)},ei=e=>Math.min(1,Math.max(0,e)),ti=(e,t,n)=>e+(t-e)*n;function ni(e){let t=Math.imul(e,747796405)+2891336453>>>0,n=Math.imul(t>>>(t>>>28)+4^t,277803737)>>>0;return(n>>>22^n)>>>0}var ri=e=>(e>>>8)/16777216,ii=(e,t)=>ri(ni(e+ni(t>>>0)>>>0));function ai(e,t,n){let r=Math.imul(e,1664525)+1013904223>>>0,i=Math.imul(t,1664525)+1013904223>>>0,a=Math.imul(n,1664525)+1013904223>>>0;for(let e=0;e<2;e++)r=r+Math.imul(i,a)>>>0,i=i+Math.imul(a,r)>>>0,a=a+Math.imul(r,i)>>>0,e===0&&(r=(r^r>>>16)>>>0,i=(i^i>>>16)>>>0,a=(a^a>>>16)>>>0);Zr[0]=r,Zr[1]=i,Zr[2]=a}var oi=(e,t)=>(e%t+t)%t;function si(e,t,n,r){ai(oi(e,r)+2654435769>>>0,oi(t,r)+2246822507>>>0,oi(n,r)+3266489909>>>0)}function ci(e,t,n,r,i,a,o){si(e,t,n,r);let s=ri(Zr[0])*2-1,c=ri(Zr[1])*2-1,l=ri(Zr[2])*2-1;return(s*i+c*a+l*o)/Math.max(Math.hypot(s,c,l),.001)}var li=e=>e*e*e*(e*(e*6-15)+10);function ui(e,t,n,r){let i=Math.floor(e),a=Math.floor(t),o=Math.floor(n),s=e-i,c=t-a,l=n-o,u=li(s),d=li(c),f=li(l),p=(e,t,n)=>ci(i+e,a+t,o+n,r,s-e,c-t,l-n),m=ti(p(0,0,0),p(1,0,0),u),h=ti(p(0,1,0),p(1,1,0),u),g=ti(p(0,0,1),p(1,0,1),u),_=ti(p(0,1,1),p(1,1,1),u);return 1.15*ti(ti(m,h,d),ti(g,_,d),f)}function di(e,t,n,r){let i=Math.floor(e),a=Math.floor(t),o=Math.floor(n),s=e-i,c=t-a,l=n-o,u=4;for(let e=-1;e<=1;e++)for(let t=-1;t<=1;t++)for(let n=-1;n<=1;n++){si(i+n,a+t,o+e,r);let d=n+ri(Zr[0])-s,f=t+ri(Zr[1])-c,p=e+ri(Zr[2])-l;u=Math.min(u,d*d+f*f+p*p)}return 1-ei(Math.sqrt(u))}function fi(e,t,n,r){let i=0,a=.5,o=0,s=1;for(let c=0;c<3;c++)i+=a*ui(e*s,t*s,n*s,r*s),o+=a,a*=.5,s*=2;return ei(.5+.5*i/o)}function pi(e,t,n){let r=di(e*4,t*4,n*4,4);Qr[0]=ti(r,1,fi(e*4,t*4,n*4,4)),Qr[1]=r,Qr[2]=di(e*8,t*8,n*8,8),Qr[3]=di(e*16,t*16,n*16,16)}function mi(e,t,n,r,i){let a=i??{cumulusCoverage:0,cirrusCoverage:0,density:1,cumulusBaseKm:0,cumulusTopKm:0,cirrusBaseKm:0,cirrusTopKm:0,seedX:0,seedY:0,cumulusDrift:[0,0],cirrusDrift:[0,0],streakBearing:0,datumRadiusKm:0};return a.cumulusCoverage=e.cloudsEnabled?e.cloudCoverage:0,a.cirrusCoverage=e.cloudsEnabled?e.cirrusCoverage:0,a.density=e.cloudDensity,a.cumulusBaseKm=e.cumulusBaseKm,a.cumulusTopKm=e.cumulusTopKm,a.cirrusBaseKm=e.cirrusBaseKm,a.cirrusTopKm=e.cirrusTopKm,a.seedX=t*13.37,a.seedY=t*7.13+100,Ir(e.windSpeed,e.windDirectionDeg,n,a.cumulusDrift),Ir(e.windSpeed*Yr,e.windDirectionDeg+Xr,n,a.cirrusDrift),a.streakBearing=(e.windDirectionDeg+Xr)*br,a.datumRadiusKm=Er+r/1e3,a}function hi(e,t){let n=Math.floor(e),r=Math.floor(t),i=e-n,a=t-r,o=li(i),s=li(a),c=ii(n,r),l=ii(n+1,r),u=ii(n,r+1),d=ii(n+1,r+1);return ti(ti(c,l,o),ti(u,d,o),s)}var gi=2.6,_i=1.156,vi=.583,yi=.5;function bi(e,t){let n=e/gi,r=t/gi,i=Math.floor(n),a=Math.floor(r),o=n-i<.5?-1:1,s=r-a<.5?-1:1,c=0;for(let e=0;e<=1;e++)for(let t=0;t<=1;t++){let l=i+t*o,u=a+e*s,d=l+.15+.7*ii(l,u+7919),f=u+.15+.7*ii(l+7919,u),p=.3+.35*ii(l+104729,u),m=ii(l,u+104729);if(m<yi)continue;let h=Math.hypot(n-d,r-f)/p;h<1&&(c=Math.max(c,(1-$r(0,1,h))*(.55+.45*(m-yi)/.5)))}return c}function xi(e,t){let n=.45*bi(e,t)+.35*hi(e/1.6+17.3,t/1.6+9.1)+.2*hi(e/.7+3.7,t/.7+41.9);return ei(_i+vi*Math.log(Math.max(n,1e-4)))}var Si=(e,t)=>.6*hi(e/30+5.1,t/30+2.3)+.4*hi(e/11+29.7,t/11+13.9);function Ci(e,t){let n=.8-.62*t;return $r(n-.09,n+.09,e)}function wi(e,t){let n=.8-.62*t;return $r(n-.09,n+.3,e)}var Ti=e=>$r(0,.04,e)*(1-$r(.62,1,e));function Ei(e,t,n,r){let i=(r-e.cumulusBaseKm)/(e.cumulusTopKm-e.cumulusBaseKm);if(i<=0||i>=1)return 0;let a=xi(t,n),o=Ci(a,e.cumulusCoverage);if(o<=0)return 0;let s=i/ti(.25,1,wi(a,e.cumulusCoverage));if(s>=1.3)return 0;pi(t/Wr,r/Wr,n/Wr);let c=Ti(s-Gr*(Qr[1]-.5)*$r(.2,.6,s));if(c<=0)return 0;let l=Qr[1]*.625+Qr[2]*.25+Qr[3]*.125,u=ei(ei((Qr[0]-l+1)/(2-l))*c-1+o);if(u<=0)return 0;let d=.35*Math.exp(-o*.75);return ei((u-d)/(1-d))}function Di(e,t,n,r){let i=(r-e.cirrusBaseKm)/(e.cirrusTopKm-e.cirrusBaseKm);if(i<=0||i>=1)return 0;let a=Ci(Si(t,n),e.cirrusCoverage);if(a<=0)return 0;let o=e.streakBearing,s=t*Math.sin(o)-n*Math.cos(o),c=t*Math.cos(o)+n*Math.sin(o);return pi(s/Kr[0],c/Kr[1],r/Kr[2]),ei((.55*Qr[0]+.45*Qr[2]-(1-a)*.9)/.5)*Math.sin(Math.PI*i)}function Oi(e,t,n,r){let i=e*t,a=i*i-(e*e-n*n);if(a<0)return r[0]=1,r[1]=-1,r;let o=Math.sqrt(a);return r[0]=-i-o,r[1]=-i+o,r}var ki=[0,0],Ai=[0,0],ji=[0,0];function Mi(e,t,n,r){if(Oi(e,t,r,ki),ki[0]>ki[1])return ji[0]=1,ji[1]=-1,ji;let i=Math.max(ki[0],0),a=ki[1];return Oi(e,t,n,Ai),Ai[0]<=Ai[1]&&(Ai[0]>i?a=Math.min(a,Ai[0]):Ai[1]>i&&(i=Ai[1])),ji[0]=i,ji[1]=a,ji}function Ni(e,t,n,r,i,a,o){if(a<=0)return 0;let s=e.datumRadiusKm+n/1e3,c=0;for(let n=0;n<2;n++){let l=n===1;if((l?e.cirrusCoverage:e.cumulusCoverage)<=0)continue;let u=Mi(s,a,e.datumRadiusKm+(l?e.cirrusBaseKm:e.cumulusBaseKm),e.datumRadiusKm+(l?e.cirrusTopKm:e.cumulusTopKm)),d=u[0],f=u[1];if(d>=f)continue;let p=l?Jr:qr,m=(f-d)/p,h=l?e.cirrusDrift:e.cumulusDrift;for(let n=0;n<p;n++){let u=d+m*(n+.5),f=i*u,p=s+a*u,g=o*u,_=Math.hypot(f,p,g)-e.datumRadiusKm,v=(t+f*1e3-h[0])*.001+e.seedX,y=(r+g*1e3-h[1])*.001+e.seedY;c+=l?Ur*e.density*Di(e,v,y,_)*m:40*e.density*Ei(e,v,y,_)*m}}return c}function Pi(e,t,n,r,i,a,o){return Math.exp(-Ni(e,t,n,r,i,a,o))}function Fi(e){return e.cloudsEnabled?1+.8*ei(e.cloudCoverage+.3*e.cirrusCoverage*(1-e.cloudCoverage))**1.5:1}function Ii(e,t=Hr,n=128){let r=t/n;return Math.round(e/r)*r}var Li=class{rc;noise;params;shadow;historyValid=!1;frameIndex=0;precomputeStage;frameLighting;marchStage;resolveStage;shadowStage;noiseSampler;shadowView;res=null;groups=null;groupsFor=null;parity=0;resolvedIndex=0;idle=!1;constructor(e,t,n){this.rc=e,this.noise=t,this.params=n;let r=e.device,i=GPUShaderStage.COMPUTE,a=e=>({binding:e,visibility:i,sampler:{type:`filtering`}}),o=(e,t=`2d`)=>({binding:e,visibility:i,texture:{sampleType:`float`,viewDimension:t}}),s=e=>({binding:e,visibility:i,storageTexture:{access:`write-only`,format:`rgba16float`}}),c=e=>({binding:e,visibility:i,buffer:{type:`uniform`}}),l=e=>({binding:11,visibility:i,buffer:{type:e,minBindingSize:96}}),u=(t,n,i)=>{let a=r.createBindGroupLayout({label:t,entries:i});return{layout:a,pipeline:r.createComputePipeline({label:t,layout:r.createPipelineLayout({bindGroupLayouts:[e.frame.layout,a]}),compute:{module:e.module(n,{MARIA_ROWS:wr}),entryPoint:`main`}})}};this.frameLighting=r.createBuffer({label:`cloud frame lighting`,size:96,usage:GPUBufferUsage.STORAGE}),this.precomputeStage=u(`cloud lighting precompute`,`sky/cloud_precompute.wgsl`,[a(0),o(1),c(5),o(40),l(`storage`)]),this.marchStage=u(`cloud march`,`sky/cloud_march.wgsl`,[a(0),o(1),s(3),c(5),o(6,`3d`),o(7,`3d`),a(8),o(40),o(41,`3d`),l(`read-only-storage`)]),this.resolveStage=u(`cloud resolve`,`sky/cloud_resolve.wgsl`,[a(0),s(3),c(5),o(9),o(10)]),this.shadowStage=u(`cloud shadow`,`sky/cloud_shadow.wgsl`,[s(3),c(5),o(6,`3d`),o(7,`3d`),a(8)]),this.noiseSampler=r.createSampler({label:`cloud noise`,addressModeU:`repeat`,addressModeV:`repeat`,addressModeW:`repeat`,magFilter:`linear`,minFilter:`linear`}),this.shadow=r.createTexture({label:`cloud shadow`,format:`rgba16float`,size:[128,128],usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.STORAGE_BINDING}),this.shadowView=this.shadow.createView(),this.prepare()}resolvedView(){return this.res.historyViews[this.resolvedIndex]}encode(e,t){if(!t&&this.idle)return;this.prepare();let n=this.res,r=this.groups,i=e.beginComputePass(this.rc.profiler?.active?this.rc.profiler.computePass(`atmosphere clouds`,`clouds`):{label:`atmosphere clouds`});this.dispatch(i,this.precomputeStage,r.precompute,1,1),this.dispatch(i,this.marchStage,r.march,Math.ceil(n.width/8),Math.ceil(n.height/8)),this.dispatch(i,this.resolveStage,r.resolve[this.parity],Math.ceil(n.width/8),Math.ceil(n.height/8)),this.dispatch(i,this.shadowStage,r.shadow,16,16),i.end(),this.resolvedIndex=this.parity,this.parity=1-this.parity,this.frameIndex++,this.idle=!t,this.historyValid=t}restart(){this.historyValid=!1,this.frameIndex=0,this.parity=0,this.resolvedIndex=0,this.idle=!1}destroy(){this.release(),this.shadow.destroy(),this.frameLighting.destroy()}dispatch(e,t,n,r,i){e.setPipeline(t.pipeline),e.setBindGroup(0,this.rc.frame.group),e.setBindGroup(1,n),e.dispatchWorkgroups(r,i)}targetSize(){let e=this.rc.gbuf,t=this.rc.quality.tier===`low`?4:Ht(this.rc.quality)?1:2;return{width:Math.max(1,Math.ceil(e.width/t)),height:Math.max(1,Math.ceil(e.height/t))}}release(){let e=this.res;e&&(e.march.destroy(),e.history[0].destroy(),e.history[1].destroy(),this.res=null)}prepare(){let e=this.targetSize();if(!this.res||this.res.width!==e.width||this.res.height!==e.height){this.release();let t=t=>this.rc.device.createTexture({label:t,format:`rgba16float`,size:[e.width,e.height],usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.STORAGE_BINDING}),n=t(`cloud march`),r=t(`cloud history 0`),i=t(`cloud history 1`);this.res={...e,march:n,history:[r,i],marchView:n.createView(),historyViews:[r.createView(),i.createView()]},this.historyValid=!1,this.idle=!1,this.parity=0}let t=this.rc.world.tex,n=this.groupsFor;n&&this.groups&&n.res===this.res&&n.t===t.transmittance&&n.s===t.skyView&&n.a===t.aerialPerspective||(this.groupsFor={t:t.transmittance,s:t.skyView,a:t.aerialPerspective,res:this.res},this.groups=this.createGroups(this.res))}createGroups(e){let t=this.rc.device,n=this.rc.world,r=n.tex,i={buffer:this.params},a=this.noise,o=r=>t.createBindGroup({label:`cloud resolve`,layout:this.resolveStage.layout,entries:[{binding:0,resource:n.samplers.linearClamp},{binding:3,resource:e.historyViews[r]},{binding:5,resource:i},{binding:9,resource:e.marchView},{binding:10,resource:e.historyViews[1-r]}]});return{precompute:t.createBindGroup({label:`cloud lighting precompute`,layout:this.precomputeStage.layout,entries:[{binding:0,resource:n.samplers.linearClamp},{binding:1,resource:r.transmittance.createView()},{binding:5,resource:i},{binding:40,resource:r.skyView.createView()},{binding:11,resource:{buffer:this.frameLighting}}]}),march:t.createBindGroup({label:`cloud march`,layout:this.marchStage.layout,entries:[{binding:0,resource:n.samplers.linearClamp},{binding:1,resource:r.transmittance.createView()},{binding:3,resource:e.marchView},{binding:5,resource:i},{binding:6,resource:a.shapeView},{binding:7,resource:a.detailView},{binding:8,resource:this.noiseSampler},{binding:40,resource:r.skyView.createView()},{binding:41,resource:r.aerialPerspective.createView({dimension:`3d`})},{binding:11,resource:{buffer:this.frameLighting}}]}),resolve:[o(0),o(1)],shadow:t.createBindGroup({label:`cloud shadow`,layout:this.shadowStage.layout,entries:[{binding:3,resource:this.shadowView},{binding:5,resource:i},{binding:6,resource:a.shapeView},{binding:7,resource:a.detailView},{binding:8,resource:this.noiseSampler}]})}}},Ri=class{shape;detail;shapeView;detailView;constructor(e,t){let n=e.device,r=(e,t)=>n.createTexture({label:e,dimension:`3d`,format:`rgba8unorm`,size:[t,t,t],usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.STORAGE_BINDING});this.shape=r(`cloud shape noise`,128),this.detail=r(`cloud detail noise`,32),this.shapeView=this.shape.createView({dimension:`3d`}),this.detailView=this.detail.createView({dimension:`3d`});let i=n.createBindGroupLayout({label:`cloud noise`,entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,storageTexture:{access:`write-only`,format:`rgba8unorm`,viewDimension:`3d`}}]}),a=n.createPipelineLayout({bindGroupLayouts:[e.frame.layout,i]}),o=(r,o,s,c)=>{let l=n.createComputePipeline({label:r,layout:a,compute:{module:e.module(`sky/cloud_noise.wgsl`,o),entryPoint:`main`}}),u=n.createBindGroup({layout:i,entries:[{binding:0,resource:s}]}),d=t.beginComputePass({label:r});d.setPipeline(l),d.setBindGroup(0,e.frame.group),d.setBindGroup(1,u);let f=c/4;d.dispatchWorkgroups(f,f,f),d.end()};o(`cloud shape bake`,{SHAPE:!0},this.shapeView,128),o(`cloud detail bake`,{DETAIL:!0},this.detailView,32)}destroy(){this.shape.destroy(),this.detail.destroy()}},zi=class{rc;skySun;skyMoon;params;views;transmittance;multiScatter;moonView;sunView;aerial;bound=null;bakedAltitudeM=null;constructor(e){this.rc=e;let t=e.device,n=GPUShaderStage.COMPUTE,r=GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.STORAGE_BINDING,i=e=>t.createTexture({label:e,format:`rgba16float`,size:[Mr.width,Mr.height],usage:r});this.skySun=i(`skySun`),this.skyMoon=i(`skyMoon`),this.views={sun:this.skySun.createView(),moon:this.skyMoon.createView()},this.params=t.createBuffer({label:`atmosphere params`,size:Pr,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});let a=e=>({binding:e,visibility:n,sampler:{type:`filtering`}}),o=e=>({binding:e,visibility:n,texture:{sampleType:`float`}}),s=(e,t=`2d`)=>({binding:e,visibility:n,storageTexture:{access:`write-only`,format:`rgba16float`,viewDimension:t}}),c=e=>({binding:e,visibility:n,buffer:{type:`uniform`}}),l={MARIA_ROWS:wr},u=(n,r,i,a={})=>{let o=t.createBindGroupLayout({label:n,entries:i});return{layout:o,pipeline:t.createComputePipeline({label:n,layout:t.createPipelineLayout({bindGroupLayouts:[e.frame.layout,o]}),compute:{module:e.module(r,{...l,...a}),entryPoint:`main`}}),group:null}};this.transmittance=u(`atmosphere transmittance`,`sky/transmittance.wgsl`,[s(3)]),this.multiScatter=u(`atmosphere multi-scatter`,`sky/multiscatter.wgsl`,[a(0),o(1),s(3)]),this.moonView=u(`atmosphere sky-view moon`,`sky/skyview.wgsl`,[a(0),o(1),o(2),s(3),c(5)],{MOON_PASS:!0}),this.sunView=u(`atmosphere sky-view sun`,`sky/skyview.wgsl`,[a(0),o(1),o(2),s(3),s(4),c(5),o(6)]),this.aerial=u(`atmosphere aerial`,`sky/aerial.wgsl`,[a(0),o(1),o(2),s(3,`3d`),c(5)]),this.bindGroups()}bake(e){let t=this.rc.settings.observer.altitudeM;if(this.bakedAltitudeM===t)return;this.bakedAltitudeM=t,this.bindGroups();let n=e.beginComputePass({label:`atmosphere lut bake`});this.dispatch(n,this.transmittance,jr.width/8,jr.height/8),this.dispatch(n,this.multiScatter,32,32),n.end()}encode(e,t){this.bindGroups();let n=Math.ceil(Mr.width/8),r=Math.ceil(Mr.height/8),i=e.beginComputePass({label:`atmosphere lut`});t&&this.dispatch(i,this.moonView,n,r),this.dispatch(i,this.sunView,n,r),this.dispatch(i,this.aerial,4,4),i.end()}destroy(){this.skySun.destroy(),this.skyMoon.destroy(),this.params.destroy()}dispatch(e,t,n,r){e.setPipeline(t.pipeline),e.setBindGroup(0,this.rc.frame.group),e.setBindGroup(1,t.group),e.dispatchWorkgroups(n,r)}bindGroups(){let e=this.rc.world,t=e.tex,n=this.bound;if(n&&n.t===t.transmittance&&n.m===t.multiScatter&&n.s===t.skyView&&n.a===t.aerialPerspective)return;this.bound={t:t.transmittance,m:t.multiScatter,s:t.skyView,a:t.aerialPerspective};let r=this.rc.device,i=t.transmittance.createView(),a=t.multiScatter.createView(),o=t.skyView.createView(),s=t.aerialPerspective.createView({dimension:`3d`}),c=e.samplers.linearClamp,l={buffer:this.params},u=(e,t)=>{e.group=r.createBindGroup({layout:e.layout,entries:t})};u(this.transmittance,[{binding:3,resource:i}]),u(this.multiScatter,[{binding:0,resource:c},{binding:1,resource:i},{binding:3,resource:a}]),u(this.moonView,[{binding:0,resource:c},{binding:1,resource:i},{binding:2,resource:a},{binding:3,resource:this.views.moon},{binding:5,resource:l}]),u(this.sunView,[{binding:0,resource:c},{binding:1,resource:i},{binding:2,resource:a},{binding:3,resource:this.views.sun},{binding:4,resource:o},{binding:5,resource:l},{binding:6,resource:this.views.moon}]),u(this.aerial,[{binding:0,resource:c},{binding:1,resource:i},{binding:2,resource:a},{binding:3,resource:s},{binding:5,resource:l}])}},Bi=new Float32Array(1),Vi=new Uint32Array(Bi.buffer);function Hi(e){Bi[0]=e;let t=Vi[0],n=t>>>16&32768,r=t>>>23&255,i=t&8388607;if(r===255)return n|31744|(i?512:0);let a=r-127+15;if(a>=31)return n|31744;if(a<=0){if(a<-10)return n;let e=i|8388608,t=14-a,r=e>>>t,o=e&(1<<t)-1,s=1<<t-1;return n|r+(o>s||o===s&&r&1?1:0)}let o=n|a<<10|i>>>13,s=i&8191;return(s>4096||s===4096&&o&1)&&o++,o}function Ui(e){let t=e&32768?-1:1,n=e>>>10&31,r=e&1023;return n===0?t*r*2**-24:n===31?r?NaN:t*(1/0):t*(1+r/1024)*2**(n-15)}var Wi=1024,Gi=9e-4,Ki=.0011,qi=.35,Ji=Math.PI*2,Yi=[1,.78,.52],Xi=[.86,.93,1],Zi=[.85,1,1.3],Qi=[[0,-2,7,4.5,.6],[27,-1,4,3,.6],[75,0,9,4,.35],[287,-1,8,3,.5],[330,0,6,3,.35],[135,-1,7,3,.2]],$i=[[301,-2.5,3.2,3.2,3],[1.5,6,9,4.5,1.8],[354,16,4,5,1.2]];function ea(e){let t=((e+180)%360+360)%360-180;return t===-180?180:t}function ta(e,t,n=[0,0]){return n[0]=e/Ji+.5,n[1]=.5-t/Math.PI,n}function na(e,t,n,r=[0,0]){let i=u,a=i[0]*e+i[3]*t+i[6]*n,o=i[1]*e+i[4]*t+i[7]*n,s=i[2]*e+i[5]*t+i[8]*n;return r[0]=Math.atan2(o,a),r[1]=Math.asin(Math.max(-1,Math.min(1,s))),r}function ra(e,t,n){let r=Math.imul(e,374761393)^Math.imul(t,668265263)^Math.imul(n,2147483647);return r=Math.imul(r^r>>>13,1274126177),((r^r>>>16)>>>0)/4294967296}function ia(e,t,n){let r=Math.floor(e),i=Math.floor(t),a=Math.floor(n),o=e-r,s=t-i,c=n-a,l=o*o*o*(o*(o*6-15)+10),u=s*s*s*(s*(s*6-15)+10),d=c*c*c*(c*(c*6-15)+10),f=(e,t,n)=>e+(t-e)*n,p=(e,t,n)=>ra(r+e,i+t,a+n);return f(f(f(p(0,0,0),p(1,0,0),l),f(p(0,1,0),p(1,1,0),l),u),f(f(p(0,0,1),p(1,0,1),l),f(p(0,1,1),p(1,1,1),l),u),d)}function aa(e,t,n,r,i){let a=0,o=.5,s=0,c=r;for(let r=0;r<i;r++)a+=o*ia(e*c+r*17.3,t*c-r*9.1,n*c+r*5.7),s+=o,o*=.5,c*=2.03;return a/s}function oa(e,t,n){let r=0;for(let i of e){let e=ea(t-i[0])/i[2],a=(n-i[1])/i[3];r+=i[4]*Math.exp(-.5*(e*e+a*a))}return r}function sa(e,t){let n=Math.abs(t),r=Math.abs(ea(e)),i=.65*Math.exp(-n/4)+.35*Math.exp(-n/14),a=.18+.82*Math.exp(-((r/55)**1.6)),o=Gi*i*a*(1+oa(Qi,e,t)),s=Ki*Math.exp(-.5*(r*r/81+t*t/42));return{nits:o+s,bulge:s/Math.max(o+s,1e-12)}}function ca(e,t,n,r,i){let a=oa($i,e,t);if(Math.abs(t)>30)return a;let o=aa(n,r,i,6,5),s=aa(n,r,i,26,4),c=Math.exp(-(((ea(e)-38)/34)**4)*.5)*Math.exp(-.5*((t-.8)/2.2)**2);return a+=1.9*c*Math.max(0,.15+1.6*o),a+=.9*Math.exp(-.5*(t/1.7)**2)*Math.max(0,s*1.6-.35),a+=.6*Math.exp(-.5*(t/5)**2)*Math.max(0,o-.5)*2,a}function la(e,t,n,r,i){let a=Math.ceil(r*3),o=new Float32Array(2*a+1),s=0;for(let e=-a;e<=a;e++)o[e+a]=Math.exp(e/r*-.5*(e/r)),s+=o[e+a];let c=new Float32Array(e.length);for(let r=0;r<n;r++)for(let n=0;n<t;n++){let l=0;for(let s=-a;s<=a;s++){let c=i?(n+s+t)%t:Math.min(t-1,Math.max(0,n+s));l+=o[s+a]*e[r*t+c]}c[r*t+n]=l/s}return c}function ua(e,t,n,r){let i=Math.ceil(r*3),a=new Float32Array(2*i+1),o=0;for(let e=-i;e<=i;e++)a[e+i]=Math.exp(e/r*-.5*(e/r)),o+=a[e+i];let s=new Float32Array(e.length);for(let r=0;r<n;r++)for(let c=0;c<t;c++){let l=0;for(let o=-i;o<=i;o++)l+=a[o+i]*e[Math.min(n-1,Math.max(0,r+o))*t+c];s[r*t+c]=l/o}return s}var da=(e,t,n,r)=>ua(la(e,t,n,r,!0),t,n,r);function fa(e,t,n){let r=new Float32Array(t*n),i=new Float32Array(t*n),a=new Float32Array(t*n).fill(1);if(!e||e.count===0)return{radiance:r,density:a};let o=e.data,s=[0,0],c=[0,0];for(let a=0;a<e.count;a++){let e=o[a*4+2];if(e<=6.5)continue;let u=o[a*4],d=o[a*4+1],f=Math.cos(d);na(f*Math.cos(u),f*Math.sin(u),Math.sin(d),c),ta(c[0],c[1],s);let p=Math.min(t-1,Math.floor(s[0]*t)),m=Math.min(n-1,Math.max(0,Math.floor(s[1]*n)));r[m*t+p]+=l(e),i[m*t+p]+=1}let u=da(r,t,n,.6/360*t);for(let e=0;e<n;e++){let r=Math.max(Math.cos((.5-(e+.5)/n)*Math.PI),.02),i=Ji/t*(Math.PI/n)*r;for(let n=0;n<t;n++)u[e*t+n]/=i}let d=da(i,t,n,1.5/360*t),f=new Float32Array(t*n);for(let e=0;e<n;e++){let n=0;for(let r=0;r<t;r++)n+=d[e*t+r];for(let r=0;r<t;r++)f[e*t+r]=n/t}let p=ua(f,t,n,6/180*n);for(let e=0;e<t*n;e++)a[e]=Math.min(2.5,Math.max(.5,d[e]/Math.max(p[e],1e-6)));return{radiance:u,density:a}}function pa(e,t=Wi,n=512){let r=new Uint16Array(t*n*4),i=fa(e,t,n),a=Hi(1);for(let e=0;e<n;e++){let o=(.5-(e+.5)/n)*Math.PI,s=Math.cos(o),c=Math.sin(o);for(let n=0;n<t;n++){let l=((n+.5)/t-.5)*Ji,u=l/br,d=o/br,f=sa(u,d),p=ca(u,d,s*Math.cos(l),s*Math.sin(l),c),m=1+qi*(i.density[e*t+n]-1),h=f.nits*m,g=(e*t+n)*4,_=f.bulge,v=1-_,y=_*Yi[0]+v*Xi[0],b=_*Yi[1]+v*Xi[1],x=_*Yi[2]+v*Xi[2],S=.2126*y+.7152*b+.0722*x,C=i.radiance[e*t+n];r[g]=Hi(h*y/S*Math.exp(-p*Zi[0])+C),r[g+1]=Hi(h*b/S*Math.exp(-p*Zi[1])+C),r[g+2]=Hi(h*x/S*Math.exp(-p*Zi[2])+C),r[g+3]=a}}return r}var ma=192,ha=4,ga=0,_a=.04,va=.02,ya=.0075,ba=(e,t,n)=>{let r=Math.min(1,Math.max(0,(n-e)/(t-e)));return r*r*(3-2*r)};function xa(){let e=new Float32Array(576),t=new Float32Array(ma),n=Math.PI*(3-Math.sqrt(5)),r=0;for(let i=0;i<ma;i++){let a=(i+.5)/ma,o=Math.sqrt(1-a*a),s=n*i;e[i*3]=o*Math.cos(s),e[i*3+1]=a,e[i*3+2]=o*Math.sin(s),t[i]=a*Math.exp(-.1/Math.max(a,va)),r+=t[i]*ba(ga,_a,a)}return{dirs:e,weight:t,kernel:2/ma*r}}var Sa=xa();Sa.kernel;var Ca=class{map;mapW=Wi/ha;mapH=512/ha;starDir;starLux;cache=new Float64Array(9);cached=!1;out=[0,0,0];gal=[0,0];uv=[0,0];constructor(e,t){let n=this.mapW,r=this.mapH,i=ha;this.map=new Float32Array(n*r*3);for(let t=0;t<r;t++)for(let r=0;r<n;r++)for(let a=0;a<i;a++)for(let o=0;o<i;o++){let s=((t*i+a)*Wi+r*i+o)*4;for(let i=0;i<3;i++)this.map[(t*n+r)*3+i]+=Ui(e[s+i])/16}let a=[],o=[],s=[0,0,0];if(t)for(let e=0;e<t.count;e++){let n=t.data[e*4+2];n>6.5||(S(t.data[e*4],t.data[e*4+1],s),a.push(s[0],s[1],s[2]),o.push(l(n)))}this.starDir=Float32Array.from(a),this.starLux=Float32Array.from(o)}needsRefresh(e){if(!this.cached)return!0;for(let t=0;t<9;t++)if(Math.abs(e[t]-this.cache[t])>ya)return!0;return!1}mapAt(e,t,n,r){na(e,t,n,this.gal),ta(this.gal[0],this.gal[1],this.uv);let i=Math.min(this.mapW-1,Math.max(0,Math.floor(this.uv[0]*this.mapW))),a=Math.min(this.mapH-1,Math.max(0,Math.floor(this.uv[1]*this.mapH)));return this.map[(a*this.mapW+i)*3+r]}compute(e,t,n,r,i){for(let t=0;t<9;t++)this.cache[t]=e[t];this.cached=!0;let a=this.out;a[0]=a[1]=a[2]=0;let{dirs:o,weight:s}=Sa,c=2/ma;for(let i=0;i<ma;i++){let l=o[i*3],u=o[i*3+1],d=o[i*3+2],f=e[0]*l+e[3]*u+e[6]*d,p=e[1]*l+e[4]*u+e[7]*d,m=e[2]*l+e[5]*u+e[8]*d,h=Nr(l*t[0]+u*t[1]+d*t[2],l*n[0]+u*n[1]+d*n[2])*Or,g=c*s[i];for(let e=0;e<3;e++)a[e]+=g*(h*kr[e]+r*this.mapAt(f,p,m,e))}if(i>0){let t=this.starDir,n=this.starLux;for(let r=0;r<n.length;r++){let o=t[r*3],s=t[r*3+1],c=t[r*3+2],l=e[3]*o+e[4]*s+e[5]*c;if(l<=va)continue;let u=i*n[r]*l*Math.exp(-.1/l)/Math.PI;a[0]+=u,a[1]+=u,a[2]+=u}}for(let e=0;e<3;e++)a[e]/=Sa.kernel;return a}},wa={cloudsEnabled:!0,cloudCoverage:.3,cirrusCoverage:.3,cloudDensity:1,windSpeed:6,windDirectionDeg:250,cumulusBaseKm:1.5,cumulusTopKm:2.8,cirrusBaseKm:8,cirrusTopKm:10,starsEnabled:!0,starBrightness:1,twinkle:.5,milkyWayEnabled:!0,milkyWayBrightness:1,nightSkyScale:1,seed:null},Ta=(e,t,n)=>Math.min(n,Math.max(t,e));function Ea(e,t=wa){let n={...t,...e},r=(e,t)=>Number.isFinite(e)?e:t;return n.cloudCoverage=Ta(r(n.cloudCoverage,t.cloudCoverage),0,1),n.cirrusCoverage=Ta(r(n.cirrusCoverage,t.cirrusCoverage),0,1),n.cloudDensity=Ta(r(n.cloudDensity,1),.05,8),n.windSpeed=Ta(r(n.windSpeed,t.windSpeed),0,80),n.windDirectionDeg=r(n.windDirectionDeg,t.windDirectionDeg),n.cumulusBaseKm=Ta(r(n.cumulusBaseKm,t.cumulusBaseKm),.3,6),n.cumulusTopKm=Ta(r(n.cumulusTopKm,t.cumulusTopKm),n.cumulusBaseKm+.3,9),n.cirrusBaseKm=Ta(r(n.cirrusBaseKm,t.cirrusBaseKm),n.cumulusTopKm+.5,14),n.cirrusTopKm=Ta(r(n.cirrusTopKm,t.cirrusTopKm),n.cirrusBaseKm+.2,16),n.starBrightness=Ta(r(n.starBrightness,1),0,20),n.twinkle=Ta(r(n.twinkle,t.twinkle),0,1),n.milkyWayBrightness=Ta(r(n.milkyWayBrightness,1),0,20),n.nightSkyScale=Ta(r(n.nightSkyScale,1),0,20),n}var Da=6.5;function Oa(e){switch(e){case`low`:return Da;case`medium`:return 7.5;default:return 8}}var ka=[.2126,.7152,.0722],Aa=[0,0,0],ja=[0,0,0];function Ma(e,t=[0,0,0]){let n=ka[0]*e[0]+ka[1]*e[1]+ka[2]*e[2];return n<=1e-9?(t[0]=t[1]=t[2]=1,t):(t[0]=e[0]/n,t[1]=e[1]/n,t[2]=e[2]/n,t)}function Na(e){let t=e.count,n=e.data,r=new Uint32Array(t);for(let e=0;e<t;e++)r[e]=e;r.sort((e,t)=>n[e*4+2]-n[t*4+2]||e-t);let i=new Float32Array(t*8),a=new Float32Array(t);for(let e=0;e<t;e++){let t=r[e],s=n[t*4],c=n[t*4+1],l=n[t*4+2],u=n[t*4+3];S(s,c,ja),Ma(o(Number.isFinite(u)?u:.6,Aa),Aa);let d=e*8;i[d]=ja[0],i[d+1]=ja[1],i[d+2]=ja[2],i[d+3]=l,i[d+4]=Aa[0],i[d+5]=Aa[1],i[d+6]=Aa[2],i[d+7]=t,a[e]=l}return{data:i,count:t,magnitudes:a}}function Pa(e,t){let n=0,r=e.length;for(;n<r;){let i=n+r>>>1;e[i]<=t?n=i+1:r=i}return n}function Fa(e,t){let n=Math.min(e.length,8);for(let r=0;r<n;r++){let n=e[r],i=r*8;Ma(n.color,Aa),t[i]=n.dir[0],t[i+1]=n.dir[1],t[i+2]=n.dir[2],t[i+3]=n.magnitude,t[i+4]=Aa[0],t[i+5]=Aa[1],t[i+6]=Aa[2],t[i+7]=1e3+r}return n}var Ia={srcFactor:`one`,dstFactor:`one`,operation:`add`},La=class{rc;params;layout;skyPipeline;starPipeline;milkyWay;planetBuffer;planetData=new Float32Array(64);planetBits=new Uint32Array(this.planetData.buffer);uploadedPlanetBits=new Uint32Array(64);uploadedPlanetCount=-1;starBuffer=null;stars=null;starCount=0;planetCount=0;lights=null;groups=new WeakMap;constructor(e,t){this.rc=e,this.params=t;let n=e.device,r=GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,i=(e,t)=>({binding:e,visibility:t,texture:{sampleType:`float`}});this.layout=n.createBindGroupLayout({label:`sky pass`,entries:[{binding:0,visibility:r,buffer:{type:`uniform`}},i(1,GPUShaderStage.FRAGMENT),i(2,GPUShaderStage.FRAGMENT),i(3,GPUShaderStage.FRAGMENT),i(4,r)]});let a=n.createPipelineLayout({bindGroupLayouts:[e.frame.layout,e.world.layout,this.layout]}),o=e=>({format:Ft.hdr,blend:e}),s={MARIA_ROWS:wr},c=e.module(`sky/sky.wgsl`,s);this.skyPipeline=n.createRenderPipeline({label:`sky`,layout:a,vertex:{module:c,entryPoint:`vs`},fragment:{module:c,entryPoint:`fs`,targets:[o()]},primitive:{topology:`triangle-list`},depthStencil:Rt});let l=e.module(`sky/stars.wgsl`,s);this.starPipeline=n.createRenderPipeline({label:`stars`,layout:a,vertex:{module:l,entryPoint:`vs`,buffers:[{arrayStride:32,stepMode:`instance`,attributes:[{shaderLocation:0,offset:0,format:`float32x4`},{shaderLocation:1,offset:16,format:`float32x4`}]}]},fragment:{module:l,entryPoint:`fs`,targets:[o({color:Ia,alpha:Ia})]},primitive:{topology:`triangle-list`},depthStencil:Rt}),this.milkyWay=n.createTexture({label:`milky way`,format:`rgba16float`,size:[Wi,512],usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST}),this.planetBuffer=n.createBuffer({label:`planets`,size:256,usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST})}setMilkyWay(e){this.rc.device.queue.writeTexture({texture:this.milkyWay},e,{bytesPerRow:Wi*8},[Wi,512])}setStars(e){if(this.starBuffer?.destroy(),this.starBuffer=null,this.stars=e,!e){this.starCount=0;return}let t=this.rc.device.createBuffer({label:`stars`,size:e.data.byteLength,usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST});this.rc.device.queue.writeBuffer(t,0,e.data),this.starBuffer=t}update(e,t){this.planetCount=Fa(e.astro.planets,this.planetData);let n=this.planetCount*8,r=this.planetCount!==this.uploadedPlanetCount;for(let e=0;!r&&e<n;e++)r=this.planetBits[e]!==this.uploadedPlanetBits[e];r&&n>0&&(this.rc.device.queue.writeBuffer(this.planetBuffer,0,this.planetData,0,n),this.uploadedPlanetBits.set(this.planetBits)),this.uploadedPlanetCount=this.planetCount,this.starCount=this.stars?Pa(this.stars.magnitudes,t):0}encode(e,t,n,r){e.setPipeline(this.skyPipeline),e.setBindGroup(2,this.group(t,n,r)),e.draw(3),e.setPipeline(this.starPipeline),this.starBuffer&&this.starCount>0&&(e.setVertexBuffer(0,this.starBuffer),e.draw(6,this.starCount)),this.planetCount>0&&(e.setVertexBuffer(0,this.planetBuffer),e.draw(6,this.planetCount))}destroy(){this.milkyWay.destroy(),this.planetBuffer.destroy(),this.starBuffer?.destroy(),this.starBuffer=null,this.groups=new WeakMap}group(e,t,n){let r=this.lights;(!r||r.sun!==e||r.moon!==t)&&(this.lights={sun:e,moon:t},this.groups=new WeakMap);let i=this.groups.get(n);return i||(i=this.rc.device.createBindGroup({label:`sky pass`,layout:this.layout,entries:[{binding:0,resource:{buffer:this.params}},{binding:1,resource:e.createView()},{binding:2,resource:t.createView()},{binding:3,resource:this.milkyWay.createView()},{binding:4,resource:n}]}),this.groups.set(n,i)),i}},Ra=new WeakMap;function za(e){return Ra.get(e)??null}var Ba=-7*Math.PI/180,Va=.002,Ha=.9,Ua=Ut({low:4,medium:5,high:6,ultra:6},10),Wa=Ut({low:0,medium:0,high:.4,ultra:.6},1),Ga=-3*Math.PI/180,Ka=class{name=`atmosphere`;sharedOverlayPass=!0;settings;luts;sky;noise;clouds;uniforms=new Vr;field=mi(wa,0,0,0);camera=[0,0,0];shadow={centerX:0,centerZ:0,extentM:Hr};moonActive=!1;device=null;nightDome=null;domeMilkyWay=-1;domeStars=-1;domeRadiance=[0,0,0];eclNorth=[0,0,0];constructor(e){this.settings=Ea(e,wa)}async init(e){this.luts=new zi(e),this.sky=new La(e,this.luts.params);let t=e.device.createCommandEncoder({label:`cloud noise bake`});this.noise=new Ri(e,t),e.device.queue.submit([t.finish()]),this.clouds=new Li(e,this.noise,this.luts.params);let n=await this.loadCatalog(),r=pa(n);this.sky.setMilkyWay(r),this.nightDome=new Ca(r,n),this.sky.setStars(n?Na(n):null),this.device=e.device,Ra.set(e.device,this)}setSettings(e){this.settings=Ea(e,this.settings)}getSettings(){return this.settings}getCloudShadowTexture(){return this.clouds?this.clouds.shadow:null}getCloudShadowMapping(){return this.shadow}cloudSunVisibility(e){let t=this.camera;return Pi(this.field,t[0],t[1],t[2],e[0],e[1],e[2])}getAmbientScale(){return Fi(this.settings)}resetLighting(){this.clouds.restart()}update(e,t){let n=t.astro,r=t.camera.pos;this.moonActive=n.moonElevation>Ba&&n.moonIlluminatedFraction>Va;let i=Oa(e.quality.tier),a=this.settings.seed??e.settings.seed;this.clouds.prepare(),this.updateNightDome(n),this.shadow.centerX=Ii(r[0]),this.shadow.centerZ=Ii(r[2]);let o=this.uniforms.write({settings:this.settings,moonScattering:this.moonActive,seed:a,timeSeconds:t.time,equatorialToWorld:n.equatorialToWorld,starMagLimit:i,cloudSteps:e.quality.cloudSteps,jitterIndex:this.clouds.frameIndex,shadowCenterX:this.shadow.centerX,shadowCenterZ:this.shadow.centerZ,shadowExtentM:this.shadow.extentM,historyBlend:Ha,historyValid:this.clouds.historyValid,lightSteps:Ua[e.quality.tier],cloudDetail:Wa[e.quality.tier],nightDome:this.domeRadiance});e.device.queue.writeBuffer(this.luts.params,0,o),this.sky.update(t,i),this.camera[0]=r[0],this.camera[1]=r[1],this.camera[2]=r[2],mi(this.settings,a,t.time,e.settings.observer.altitudeM,this.field)}updateNightDome(e){let t=this.nightDome,n=this.settings;if(!t||e.sunElevation>Ga){this.domeRadiance.fill(0),this.domeMilkyWay=this.domeStars=-1;return}let r=n.milkyWayEnabled?n.milkyWayBrightness:0,i=n.starsEnabled?n.starBrightness:0;if(!t.needsRefresh(e.equatorialToWorld)&&r===this.domeMilkyWay&&i===this.domeStars)return;this.domeMilkyWay=r,this.domeStars=i,Lr(e.equatorialToWorld,this.eclNorth);let a=t.compute(e.equatorialToWorld,e.sunDir,this.eclNorth,r,i);this.domeRadiance[0]=a[0],this.domeRadiance[1]=a[1],this.domeRadiance[2]=a[2]}encodePre(e){this.luts.bake(e),this.luts.encode(e,this.moonActive),this.clouds.encode(e,this.settings.cloudsEnabled)}encodeSky(e){this.sky.encode(e,this.luts.skySun,this.luts.skyMoon,this.clouds.resolvedView())}destroy(){this.device&&Ra.get(this.device)===this&&Ra.delete(this.device),this.sky.destroy(),this.clouds.destroy(),this.noise.destroy(),this.luts.destroy()}async loadCatalog(){try{return await oe()}catch(e){return console.warn(`atmosphere: no star catalogue, the sky will have no stars`,e),null}}};function qa(e={}){return new Ka(e)}var F={GATE_FRAME:1,GATE_CHEVRON:2,GATE_LED:3,GATE_BASE:4,GATE_CHECKER:5,CONE:6,POLE:7,FLAGPOLE:8,WALL:9,ROCK:10,TRUNK:11,LEAVES:12,CLOTH:13,PAD:14,PAD_EDGE:15,CONTAINER:16,CONCRETE:17,HAZARD:18,STEEL_PAINT:19,CARBON:20,ALU:21,PCB:22,BATTERY:23,RUBBER:24,MOTOR_BELL:25,MOTOR_BASE:26,PLASTIC:27,LENS:28,LED:29,PROP:30,WIRE:31,STEEL:32,PROP_HUB:33,GATE_PANEL:34};function Ja(){let e={};for(let[t,n]of Object.entries(F))e[`K_${t}`]=n;return e}var Ya=[[1,.24,.02],[.42,.85,.02],[.9,.03,.42]],Xa=[.03,.62,.1];function Za(e){return e===0?Xa:Ya[(e-1)%Ya.length]}var Qa=[[.33,.055,.03],[.025,.11,.32],[.04,.2,.075],[.62,.17,.02],[.3,.3,.29],[.6,.6,.57],[.19,.03,.04],[.6,.38,.02]],$a=[[.42,.43,.44],[.55,.04,.025],[.72,.72,.7],[.7,.45,.02],[.04,.16,.38]];function eo(e,t){return Math.round(Math.min(e,9.99)*100)*1e3+Math.round(Math.min(t,9.99)*100)}var to=[1,0,0,0,0,1,0,0,0,0,1,0];function no(e,t){let n=Array(12);for(let r=0;r<3;r++){for(let i=0;i<3;i++)n[r*4+i]=e[r*4]*t[i]+e[r*4+1]*t[4+i]+e[r*4+2]*t[8+i];n[r*4+3]=e[r*4]*t[3]+e[r*4+1]*t[7]+e[r*4+2]*t[11]+e[r*4+3]}return n}var ro=(e,t,n)=>[1,0,0,e,0,1,0,t,0,0,1,n];function io(e){let t=Math.cos(e),n=Math.sin(e);return[t,0,n,0,0,1,0,0,-n,0,t,0]}function ao(e){let t=Math.cos(e),n=Math.sin(e);return[1,0,0,0,0,t,-n,0,0,n,t,0]}function oo(e,t,n,r){return[e[0],t[0],n[0],r[0],e[1],t[1],n[1],r[1],e[2],t[2],n[2],r[2]]}var so=class{kind=0;ao=1;a2=0;a3=0;aoFn=null;verts=[];idx=[];xf=to;stack=[];get vertexCount(){return this.verts.length/12}get triangleCount(){return this.idx.length/3}push(e){this.stack.push(this.xf),this.xf=no(this.xf,e)}pop(){let e=this.stack.pop();if(!e)throw Error(`MeshBuilder.pop without push`);this.xf=e}vertex(e,t,n=0,r=0){let i=this.xf,a=i[0]*e[0]+i[1]*e[1]+i[2]*e[2]+i[3],o=i[4]*e[0]+i[5]*e[1]+i[6]*e[2]+i[7],s=i[8]*e[0]+i[9]*e[1]+i[10]*e[2]+i[11],c=i[0]*t[0]+i[1]*t[1]+i[2]*t[2],l=i[4]*t[0]+i[5]*t[1]+i[6]*t[2],u=i[8]*t[0]+i[9]*t[1]+i[10]*t[2],d=Math.hypot(c,l,u)||1;c/=d,l/=d,u/=d;let f=this.ao*(this.aoFn?this.aoFn(a,o,s):1);return this.verts.push(a,o,s,c,l,u,n,r,this.kind,f,this.a2,this.a3),this.verts.length/12-1}tri(e,t,n){let r=this.verts,i=e*12,a=t*12,o=n*12,s=r[a]-r[i],c=r[a+1]-r[i+1],l=r[a+2]-r[i+2],u=r[o]-r[i],d=r[o+1]-r[i+1],f=r[o+2]-r[i+2],p=c*f-l*d,m=l*u-s*f,h=s*d-c*u;if(p*p+m*m+h*h<1e-18)return;let g=r[i+3]+r[a+3]+r[o+3],_=r[i+4]+r[a+4]+r[o+4],v=r[i+5]+r[a+5]+r[o+5];p*g+m*_+h*v<0?this.idx.push(e,n,t):this.idx.push(e,t,n)}quad(e,t,n,r){this.tri(e,t,n),this.tri(e,n,r)}append(e){let t=this.vertexCount,n=e.vertices;for(let e=0;e<n.length;e+=12){let t=this.kind,r=this.ao,i=this.a2,a=this.a3;this.kind=n[e+8],this.ao=n[e+9],this.a2=n[e+10],this.a3=n[e+11],this.vertex([n[e],n[e+1],n[e+2]],[n[e+3],n[e+4],n[e+5]],n[e+6],n[e+7]),this.kind=t,this.ao=r,this.a2=i,this.a3=a}for(let n=0;n<e.indices.length;n+=3)this.tri(t+e.indices[n],t+e.indices[n+1],t+e.indices[n+2])}finish(){return{vertices:new Float32Array(this.verts),indices:new Uint32Array(this.idx)}}},co=[[1,0,0],[0,1,0],[0,0,1]];function lo(e,t,n,r,i,a,o,s){let c=[e[0],e[1],e[2]];return c[n]+=r*i,c[a]+=o*s,c[3-n-a]+=t,c}function uo(e,t,n,r=0){for(let i=0;i<3;i++)for(let a of[-1,1]){let o=(i+1)%3,s=(i+2)%3,c=[co[i][0]*a,co[i][1]*a,co[i][2]*a],l=[];for(let[u,d]of[[-1,-1],[1,-1],[1,1],[-1,1]]){let f=[t[0],t[1],t[2]];f[i]+=a*n[i],f[o]+=u*(n[o]-r),f[s]+=d*(n[s]-r);let p=u*(n[o]-r),m=d*(n[s]-r);l.push(e.vertex(f,c,i===2?p:m,i===2?m:p))}e.quad(l[0],l[1],l[2],l[3])}if(!(r<=0)){for(let i=0;i<3;i++)for(let a=i+1;a<3;a++){let o=3-i-a;for(let s of[-1,1])for(let c of[-1,1]){let l=[co[i][0]*s,co[i][1]*s,co[i][2]*s],u=[co[a][0]*c,co[a][1]*c,co[a][2]*c],d=[];for(let f of[-(n[o]-r),n[o]-r])d.push(e.vertex(lo(t,f,i,s,n[i],a,c,n[a]-r),l,f,0)),d.push(e.vertex(lo(t,f,i,s,n[i]-r,a,c,n[a]),u,f,r));e.quad(d[0],d[1],d[3],d[2])}}for(let i of[-1,1])for(let a of[-1,1])for(let o of[-1,1]){let s=[i,a,o],c=[];for(let i=0;i<3;i++){let a=[t[0]+s[0]*(n[0]-r),t[1]+s[1]*(n[1]-r),t[2]+s[2]*(n[2]-r)];a[i]+=s[i]*r,c.push(e.vertex(a,[co[i][0]*s[i],co[i][1]*s[i],co[i][2]*s[i]],0,0))}e.tri(c[0],c[1],c[2])}}}function fo(e,t,n,r={}){let i=Math.cos(r.hardAngle??.7),a=r.startAngle??0,o=r.sweep??Math.PI*2,s=t.length,c=[],l=[];for(let e=0;e<s-1;e++){let n=t[e+1][0]-t[e][0],r=t[e+1][1]-t[e][1],i=Math.hypot(n,r)||1;c.push([r/i,-n/i]),l.push(i)}let u=[],d=0;for(let f=0;f<s;f++){let p=f>0?c[f-1]:c[0],m=f<s-1?c[f]:c[s-2],h=f>0&&f<s-1&&p[0]*m[0]+p[1]*m[1]>i,g=[p[0]+m[0],p[1]+m[1]],_=Math.hypot(g[0],g[1])||1,v=i=>{let s=[];for(let c=0;c<=n;c++){let l=a+o*c/n,u=Math.cos(l),p=Math.sin(l),m=t[f][0];s.push(e.vertex([m*u,t[f][1],m*p],[i[0]*u,i[1],i[0]*p],r.polar?l:l*m,r.polar?t[f][1]:d))}return s},y=v(h?[g[0]/_,g[1]/_]:p);u.push([y,h||f===0||f===s-1?y:v(m)]),f<s-1&&(d+=l[f])}for(let t=0;t<s-1;t++){let r=u[t][1],i=u[t+1][0];for(let t=0;t<n;t++)e.quad(r[t],r[t+1],i[t+1],i[t])}}function po(e,t,n,r,i={}){let a=.25/n,o=.25/r,[s,c]=i.uvScale??[1,1],l=[];for(let u=0;u<=r;u++)for(let d=0;d<=n;d++){let f=d/n,p=u/r,m=t(f,p),h;if(i.normalFn)h=i.normalFn(f,p,m);else{let e=Math.min(Math.max(p,o),1-o),n=t(Math.max(f-a,i.wrapU?-1:0),e),r=t(Math.min(f+a,i.wrapU?2:1),e),s=t(f,Math.max(e-o,0)),c=t(f,Math.min(e+o,1)),l=[r[0]-n[0],r[1]-n[1],r[2]-n[2]],u=[c[0]-s[0],c[1]-s[1],c[2]-s[2]];h=[l[1]*u[2]-l[2]*u[1],l[2]*u[0]-l[0]*u[2],l[0]*u[1]-l[1]*u[0]]}l.push(e.vertex(m,h,f*s,p*c))}for(let t=0;t<r;t++)for(let r=0;r<n;r++){let i=t*(n+1)+r;e.quad(l[i],l[i+1],l[i+n+2],l[i+n+1])}}function mo(e){let t=0;for(let n=0;n<e.length;n++){let r=e[(n+1)%e.length];t+=e[n][0]*r[1]-r[0]*e[n][1]}return t/2}function ho(e,t,n){let r=!1;for(let i=0,a=n.length-1;i<n.length;a=i++){let[o,s]=n[i],[c,l]=n[a];s>t!=l>t&&e<(c-o)*(t-s)/(l-s)+o&&(r=!r)}return r}var go=(e,t,n,r)=>e*r-t*n;function _o(e,t,n,r){let i=go(t[0]-e[0],t[1]-e[1],n[0]-e[0],n[1]-e[1]),a=go(t[0]-e[0],t[1]-e[1],r[0]-e[0],r[1]-e[1]),o=go(r[0]-n[0],r[1]-n[1],e[0]-n[0],e[1]-n[1]),s=go(r[0]-n[0],r[1]-n[1],t[0]-n[0],t[1]-n[1]);return(i>0&&a<0||i<0&&a>0)&&(o>0&&s<0||o<0&&s>0)}var vo=(e,t)=>e[0]===t[0]&&e[1]===t[1];function yo(e,t){return mo(e)>0===t?e.slice():e.slice().reverse()}function bo(e,t,n,r){let i=t=>e.slice(t.start,t.start+t.len),a=t.map(t=>e[t]),o=r.map(i),s=[];for(let r=0;r<n.len;r++){let i=e[n.start+r];for(let e=0;e<t.length;e++)s.push({d:(i[0]-a[e][0])**2+(i[1]-a[e][1])**2,h:r,k:e})}s.sort((e,t)=>e.d-t.d);let c=(e,t,n)=>{for(let r=0;r<n.length;r++)if(_o(e,t,n[r],n[(r+1)%n.length]))return!0;return!1};for(let r of s){let i=e[n.start+r.h],s=a[r.k];if(c(i,s,a)||o.some(e=>c(i,s,e)))continue;let l=(i[0]+s[0])/2,u=(i[1]+s[1])/2;if(!ho(l,u,a)||o.some(e=>ho(l,u,e)))continue;let d=t.slice(0,r.k+1);for(let e=0;e<=n.len;e++)d.push(n.start+(r.h+e)%n.len);d.push(t[r.k]);for(let e=r.k+1;e<t.length;e++)d.push(t[e]);return d}throw Error(`triangulate: no valid bridge to hole`)}function xo(e,t,n){let r=t.length,i=t.map((e,t)=>(t+1)%r),a=t.map((e,t)=>(t+r-1)%r),o=Array(r).fill(!0),s=n=>e[t[n]],c=e=>{let t=s(a[e]),n=s(e),r=s(i[e]);if(go(n[0]-t[0],n[1]-t[1],r[0]-t[0],r[1]-t[1])<=0)return!1;for(let o=i[i[e]];o!==a[e];o=i[o]){let e=s(o);if(!(vo(e,t)||vo(e,n)||vo(e,r))&&go(n[0]-t[0],n[1]-t[1],e[0]-t[0],e[1]-t[1])>=0&&go(r[0]-n[0],r[1]-n[1],e[0]-n[0],e[1]-n[1])>=0&&go(t[0]-r[0],t[1]-r[1],e[0]-r[0],e[1]-r[1])>=0)return!1}return!0},l=e=>{o[e]=!1,i[a[e]]=i[e],a[i[e]]=a[e]},u=r,d=0,f=0;for(;u>3;)if(c(d)){n.push(t[a[d]],t[d],t[i[d]]);let e=i[d];l(d),u--,d=e,f=0}else if(d=i[d],++f>u){let e=d,t=1/0;for(let n=d,r=0;r<u;n=i[n],r++){let r=s(a[n]),o=s(n),c=s(i[n]),l=Math.abs(go(o[0]-r[0],o[1]-r[1],c[0]-r[0],c[1]-r[1]));l<t&&(t=l,e=n)}d=i[e],l(e),u--,f=0}let p=o.indexOf(!0),m=s(a[p]),h=s(p),g=s(i[p]);go(h[0]-m[0],h[1]-m[1],g[0]-m[0],g[1]-m[1])>0&&n.push(t[a[p]],t[p],t[i[p]])}function So(e,t=[]){let n=yo(e,!0),r=n.map((e,t)=>t),i=[];for(let e of t){let t=yo(e,!1);i.push({start:n.length,len:t.length}),n.push(...t)}let a=i.slice().sort((e,t)=>Math.max(...n.slice(t.start,t.start+t.len).map(e=>e[0]))-Math.max(...n.slice(e.start,e.start+e.len).map(e=>e[0])));for(let e=0;e<a.length;e++)r=bo(n,r,a[e],a.slice(e));let o=[];return xo(n,r,o),{points:n,triangles:o}}var Co=(e,t)=>{let n=Math.hypot(e,t)||1;return[e/n,t/n]};function wo(e,t,n,r,i,a={}){let o=So(t,n),s=o.points,c=Math.cos(a.hardAngle??.6),l=a.chamfer??0,u=[[0,t.length]],d=t.length;for(let e of n)u.push([d,e.length]),d+=e.length;let f=Array(s.length),p=Array(s.length);for(let[e,t]of u){for(let n=0;n<t;n++){let r=s[e+n],i=s[e+(n+1)%t];f[e+n]=Co(i[1]-r[1],-(i[0]-r[0]))}for(let n=0;n<t;n++){let r=f[e+(n+t-1)%t],i=f[e+n],a=Co(r[0]+i[0],r[1]+i[1]),o=l/Math.max(.5,a[0]*r[0]+a[1]*r[1]);p[e+n]=[-a[0]*o,-a[1]*o]}}let m=i-l,h=a.noBottom?r:r+l,g=(t,n)=>s.map((r,i)=>e.vertex([r[0]+(l>0?p[i][0]:0),t,r[1]+(l>0?p[i][1]:0)],[0,n,0],r[0],r[1])),_=g(i,1);for(let t=0;t<o.triangles.length;t+=3)e.tri(_[o.triangles[t]],_[o.triangles[t+1]],_[o.triangles[t+2]]);if(!a.noBottom){let t=g(r,-1);for(let n=0;n<o.triangles.length;n+=3)e.tri(t[o.triangles[n]],t[o.triangles[n+1]],t[o.triangles[n+2]])}let v=e.kind;for(let[t,n]of u){let o=0;for(let u=0;u<n;u++){let d=(u+1)%n,g=s[t+u],_=s[t+d],y=f[t+(u+n-1)%n],b=f[t+d],x=f[t+u],S=y[0]*x[0]+y[1]*x[1]>c?Co(y[0]+x[0],y[1]+x[1]):x,C=x[0]*b[0]+x[1]*b[1]>c?Co(x[0]+b[0],x[1]+b[1]):x,w=Math.hypot(_[0]-g[0],_[1]-g[1]);a.wallKind!==void 0&&(e.kind=a.wallKind);let T=e.vertex([g[0],h,g[1]],[S[0],0,S[1]],o,h),E=e.vertex([g[0],m,g[1]],[S[0],0,S[1]],o,m),D=e.vertex([_[0],h,_[1]],[C[0],0,C[1]],o+w,h),O=e.vertex([_[0],m,_[1]],[C[0],0,C[1]],o+w,m);if(e.quad(T,D,O,E),l>0){e.kind=v;for(let[n,s,c]of[[1,m,i],...a.noBottom?[]:[[-1,h,r]]]){let r=Math.SQRT1_2,i=e.vertex([g[0],s,g[1]],[S[0]*r,n*r,S[1]*r],o,s),a=e.vertex([g[0]+p[t+u][0],c,g[1]+p[t+u][1]],[S[0]*r,n*r,S[1]*r],o,c),l=e.vertex([_[0],s,_[1]],[C[0]*r,n*r,C[1]*r],o+w,s),f=e.vertex([_[0]+p[t+d][0],c,_[1]+p[t+d][1]],[C[0]*r,n*r,C[1]*r],o+w,c);e.quad(i,l,f,a)}}o+=w}}e.kind=v}var To=.06475,Eo=.0088,Do=.005,Oo=.0135,ko=.104,Ao=16,jo=14;function Mo(e){return e>.9?Math.sqrt(Math.max(0,1-((e-.9)/.1)**2)):1}function No(e){return Oo*(.72+.28*Math.sin(Math.min(e/.45,1)*Math.PI*.5)-.45*Math.max(0,(e-.45)/.55)**1.6)*Mo(e)}function Po(e){return Math.atan(ko/(2*Math.PI*Math.max(e,.014)))}function Fo(e,t){let n=1-(1-t)**1.5,r=Do+n*.059750000000000004,i=No(n),a=(e-Math.floor(e))*Math.PI*2,o=(1+Math.cos(a))/2,s=-Math.cos(a/2),c=s>=0?1:-1,l=-.126*o-.3516*o*o+.2843*o**3-.1036*o**4,u=5*((.0016*(1-n)+6e-4)*Mo(n))*(.2969*s+c*l)+.16*i*o*(1-o),d=(o-.4)*i+.004*n*n,f=Po(r),p=Math.sin(f),m=Math.cos(f);return[r,-d*p+u*m,d*m+u*p]}function Io(e){e.kind=F.PROP,e.aoFn=(e,t,n)=>.55+.45*Math.min(1,Math.max(0,(Math.hypot(e,n)-Eo)/.012)),po(e,Fo,Ao,jo,{wrapU:!0}),e.aoFn=null}function Lo(e){let t=e/Math.sqrt(3);return Array.from({length:6},(e,n)=>[t*Math.cos(n*Math.PI/3),t*Math.sin(n*Math.PI/3)])}function Ro(e){e.kind=F.PROP_HUB,fo(e,[[0,-.0025],[.0079,-.0025],[.0088,-.0016],[.0088,.0012],[.0078,.0025],[.005,.0025],[0,.0025]],28,{hardAngle:.9}),e.kind=F.STEEL,wo(e,Lo(.0075),[],.0025,.0062,{hardAngle:.6})}function zo(e){let t=new so;e&&t.push(oo([1,0,0],[0,1,0],[0,0,-1],[0,0,0]));for(let e=0;e<3;e++)t.push(io(e*Math.PI*2/3)),Io(t),t.pop();return Ro(t),e&&t.pop(),t.finish()}var Bo=[0,.023249230769,.000593846154],Vo=.22/(2*Math.SQRT2),Ho=.006,Uo=.022,Wo=[-1,1,-1,1],Go=[[1,-1],[1,1],[-1,1],[-1,-1]].map(([e,t])=>[e*Vo,0,t*Vo]),Ko=e=>[e[0]-Bo[0],e[1]-Bo[1],e[2]-Bo[2]],qo=Go.map(e=>Ko([e[0],Ho,e[2]])),Jo=Go.map(e=>Ko([e[0],Uo,e[2]])),Yo={y0:-.0065,y1:-.0015},Xo={y0:.031,y1:.033},Zo={x:.0205,z:.04},Qo={x:.0245,z:.055},$o={centre:[0,.05,0],half:[.0175,.016,.0375]},es=.024,ts={pos:[0,.02,-.062],tilt:30*Math.PI/180};Yo.y1;var ns=e=>(t,n,r)=>e(t+Bo[0],n+Bo[1],r+Bo[2]);function rs(e,t){return[e[0]*t[0]+e[1]*t[1]+e[2]*t[2]+e[3],e[4]*t[0]+e[5]*t[1]+e[6]*t[2]+e[7],e[8]*t[0]+e[9]*t[1]+e[10]*t[2]+e[11]]}var is=(e,t,n)=>{let r=Math.min(1,Math.max(0,(n-e)/(t-e)));return r*r*(3-2*r)},as=Math.PI*2,os=35,ss=65,cs=.26,ls=.35,us=.3,ds=.45,fs=[[1,.04,.02],[1,.04,.02],[1,.93,.8],[1,.93,.8]],ps=1.3;function ms(e,t,n){let r=Math.min(1,Math.max(0,(n-e)/(t-e)));return r*r*(3-2*r)}var hs=e=>1-ms(40,60,Math.abs(e)),gs=e=>cs*ms(os,ss,Math.abs(e));function _s(){let e=new Float64Array(4);for(let t=0;t<4;t++)e[t]=t*.7;let t=new Float64Array(4);for(let n=0;n<4;n++)t[n]=Wo[n]*e[n];return{phase:e,angle:t,prevAngle:Float64Array.from(t),solid:new Float64Array(4).fill(1),blur:new Float64Array(4)}}function vs(e,t,n){for(let r=0;r<4;r++){let i=Number.isFinite(t[r])?t[r]:0;e.prevAngle[r]=e.angle[r],e.phase[r]=(e.phase[r]+Math.abs(i)*(Number.isFinite(n)?n:0))%as,e.angle[r]=Wo[r]*e.phase[r],e.solid[r]=hs(i),e.blur[r]=gs(i)}}function ys(e,t){if(e)return 1;let n=t*ps%1;return ms(0,.03,n)-ms(.2,.24,n)}function bs(e,t,n){let[r,i,a,o]=n;e[0]=1-2*(i*i+a*a),e[1]=2*(r*i+a*o),e[2]=2*(r*a-i*o),e[3]=0,e[4]=2*(r*i-a*o),e[5]=1-2*(r*r+a*a),e[6]=2*(i*a+r*o),e[7]=0,e[8]=2*(r*a+i*o),e[9]=2*(i*a-r*o),e[10]=1-2*(r*r+i*i),e[11]=0,e[12]=t[0],e[13]=t[1],e[14]=t[2],e[15]=1}function xs(){return{model:new Float32Array(16),prevModel:new Float32Array(16),valid:!1}}function Ss(e,t,n){let r=e.valid&&Math.hypot(t[0]-e.model[12],t[1]-e.model[13],t[2]-e.model[14])>2;e.valid&&!r&&e.prevModel.set(e.model),bs(e.model,t,n),(!e.valid||r)&&e.prevModel.set(e.model),e.valid=!0}function Cs(e,t){return Math.hypot(e[0]-t[0],e[1]-t[1],e[2]-t[2])<ls}var ws=no(ro(ts.pos[0],ts.pos[1],ts.pos[2]),ao(ts.tilt)),Ts=.0117,Es=.0122,Ds=[[-.016,Xo.y1+7e-4,.046],[.016,Xo.y1+7e-4,.046]],Os=[[-.0117,Es,-.0075],[Ts,Es,-.0075]],ks=[...Ds,...Os.map(e=>rs(ws,e))],As=rs(ws,[.0018,.0022,-.0182]);function js(e){e.push(ws),e.kind=F.PLASTIC,e.a2=2,e.ao=.9,uo(e,[0,0,0],[.0095,.0095,.0085],8e-4),e.ao=1,e.kind=F.ALU,e.a2=1;for(let t of[-1,1])uo(e,[t*Ts,0,0],[.002,.0115,.0105],5e-4);e.a2=2,e.push(ao(-Math.PI/2)),fo(e,[[0,.0085],[.0068,.0085],[.0068,.0125],[.0055,.0125],[.0055,.0148],[0,.0148]],20,{hardAngle:.6}),e.kind=F.LENS,fo(e,[[0,.0148],[.0044,.0148],[.0042,.0158],[.0032,.0172],[.0016,.0181],[0,.0184]],20,{hardAngle:.9}),e.pop(),e.a2=0,e.pop()}function Ms(e){e.kind=F.ALU,e.a2=1;for(let t of[-1,1])uo(e,[t*Ts,.0148,-.0525],[.002,.0155,.0015],4e-4);e.a2=0}function Ns(e){e.kind=F.LED,ks.forEach((t,n)=>{e.a2=n,n<2?uo(e,t,[.0022,7e-4,.0025]):(e.push(ws),uo(e,Os[n-2],[.0014,7e-4,.0014]),e.pop())}),e.a2=0}function Ps(e){js(e),Ms(e),Ns(e)}var Fs=(e,t,n,r,i)=>Math.hypot(e-n,t-r)-i;function Is(e,t,n,r,i,a,o){let s=Math.abs(e-n)-(i-o),c=Math.abs(t-r)-(a-o);return Math.hypot(Math.max(s,0),Math.max(c,0))+Math.min(Math.max(s,c),0)-o}function Ls(e,t,n,r,i,a,o,s){let c=Math.hypot(i-n,a-r),l=(i-n)/c,u=(a-r)/c,d=e-n,f=t-r,p=d*l+f*u,m=Math.abs(-d*u+f*l),h=(o-s)/c,g=Math.sqrt(1-h*h),_=m*-h+p*g;return _<0?Math.hypot(m,p)-o:_>g*c?Math.hypot(m,p-c)-s:m*g+p*h-o}var Rs=(e,t,n,r,i,a,o)=>Ls(e,t,n,r,i,a,o,o);function zs(e,t,n){let r=Math.max(n-Math.abs(e-t),0)/n;return Math.min(e,t)-r*r*n*.25}var Bs=(e,t)=>Math.max(e,-t);function Vs(e,t,n){let r=Math.ceil((t.x1-t.x0)/n),i=Math.ceil((t.z1-t.z0)/n),a=r+1,o=new Float64Array(a*(i+1));for(let s=0;s<=i;s++)for(let i=0;i<=r;i++)o[s*a+i]=e(t.x0+i*n,t.z0+s*n);let s=a*(i+1),c=e=>{let r=e>=s,i=r?e-s:e,c=i%a,l=(i-c)/a,u=o[l*a+c],d=u/(u-(r?o[(l+1)*a+c]:o[l*a+c+1]));return r?[t.x0+c*n,t.z0+(l+d)*n]:[t.x0+(c+d)*n,t.z0+l*n]},l=new Map,u=(e,t)=>{(l.get(e)??l.set(e,[]).get(e)).push(t),(l.get(t)??l.set(t,[]).get(t)).push(e)};for(let e=0;e<i;e++)for(let t=0;t<r;t++){let n=o[e*a+t],r=o[e*a+t+1],i=o[(e+1)*a+t+1],c=o[(e+1)*a+t],l=e*a+t,d=(e+1)*a+t,f=s+e*a+t,p=s+e*a+t+1,m=n<0|(r<0?2:0)|(i<0?4:0)|(c<0?8:0),h=(n+r+i+c)/4<0;switch(m){case 1:case 14:u(l,f);break;case 2:case 13:u(l,p);break;case 3:case 12:u(f,p);break;case 4:case 11:u(p,d);break;case 6:case 9:u(l,d);break;case 7:case 8:u(f,d);break;case 5:h?(u(l,p),u(f,d)):(u(l,f),u(p,d));break;case 10:h?(u(l,f),u(p,d)):(u(l,p),u(f,d))}}let d=[],f=new Set;for(let e of l.keys()){if(f.has(e))continue;let t=[],n=-1,r=e;for(;!f.has(r);){f.add(r),t.push(c(r));let e=l.get(r).find(e=>e!==n&&!f.has(e));if(e===void 0)break;n=r,r=e}t.length>=3&&d.push(t)}return d}function Hs(e,t){let n=e.length,r=0,i=-1;for(let t=1;t<n;t++){let n=Math.hypot(e[t][0]-e[0][0],e[t][1]-e[0][1]);n>i&&(i=n,r=t)}let a=new Uint8Array(n);a[0]=1,a[r]=1;let o=(r,i)=>{let[s,c]=e[r%n],[l,u]=e[i%n],d=Math.hypot(l-s,u-c)||1e-12,f=-1,p=-1;for(let t=r+1;t<i;t++){let[r,i]=e[t%n],a=Math.abs((r-s)*(u-c)-(i-c)*(l-s))/d;a>f&&(f=a,p=t)}f>t&&(a[p%n]=1,o(r,p),o(p,i))};return o(0,r),o(r,n),e.filter((e,t)=>a[t]===1)}function Us(e,t,n,r){let i=Vs(e,t,n).map(e=>Hs(e,r)).filter(e=>e.length>=3),a=i.map((e,t)=>i.reduce((n,r,i)=>n+(i!==t&&ho(e[0][0],e[0][1],r)?1:0),0)),o=[],s=new Map;return i.forEach((e,t)=>{if(a[t]%2==0){let n={outline:e,holes:[]};o.push(n),s.set(t,n)}}),i.forEach((e,t)=>{if(a[t]%2==1){let t,n=1/0;for(let[r,a]of s){let o=Math.abs(mo(i[r]));ho(e[0][0],e[0][1],i[r])&&o<n&&(t=a,n=o)}t?.holes.push(e)}}),o}var Ws=[[1,-1],[1,1],[-1,1],[-1,-1]],Gs=.026;function Ks(e,t){let n=Is(e,t,0,0,Qo.x,Qo.z,.01);for(let[r,i]of Ws){let a=r*Vo,o=i*Vo;n=zs(n,Ls(e,t,r*Gs,i*Gs,a,o,.0105,.0072),.014),n=zs(n,Fs(e,t,a,o,.0165),.01)}for(let[r,i]of Ws){let a=Math.SQRT1_2;n=Bs(n,Rs(e,t,r*.05*a,i*.05*a,r*.078*a,i*.078*a,.0028))}return n=Bs(n,Is(e,t,0,.044,.008,.004,.003)),Bs(n,Is(e,t,0,-.044,.008,.004,.003))}function qs(e,t){let n=Is(e,t,0,0,Qo.x,.052,.009);for(let r of[-1,1])for(let i of[-1,1])n=Bs(n,Rs(e,t,r*.0105,i*.026,r*.0105,i*.038,.0035)),n=Bs(n,Is(e,t,r*.0182,i*.024,.0012,.0105,.0012));return n}var Js=ns((e,t,n)=>1-.3*(1-is(.6,1.5,Math.max(Math.abs(e)/.03,Math.abs(n)/.055))));function Ys(e){e.kind=F.CARBON,e.aoFn=Js;for(let t of Us(Ks,{x0:-.1,z0:-.1,x1:.1,z1:.1},.0015,25e-5))wo(e,t.outline,t.holes,Yo.y0,Yo.y1,{chamfer:6e-4,hardAngle:.7});e.aoFn=null;for(let t of Us(qs,{x0:-.04,z0:-.07,x1:.04,z1:.07},6e-4,2e-4))wo(e,t.outline,t.holes,Xo.y0,Xo.y1,{chamfer:4e-4,hardAngle:.7})}function Xs(e){let t=Yo.y1,n=Xo.y0;for(let[r,i]of Ws)e.push([1,0,0,r*Zo.x,0,1,0,0,0,0,1,i*Zo.z]),e.kind=F.ALU,e.a2=1,e.ao=.85,fo(e,[[0,t],[.0027,t],[.0028,t+3e-4],[.0028,n-3e-4],[.0027,n],[0,n]],14,{hardAngle:.7}),e.a2=0,e.ao=1,e.kind=F.STEEL,fo(e,[[0,Xo.y1],[.0034,Xo.y1],[.0034,Xo.y1+8e-4],[.0026,Xo.y1+.0021],[0,Xo.y1+.0025]],12,{hardAngle:.8}),fo(e,[[0,Yo.y0-.0023],[.0018,Yo.y0-.0022],[.003,Yo.y0-.0012],[.0032,Yo.y0]],12,{hardAngle:.8}),e.pop()}function Zs(e){Ys(e),Xs(e)}function Qs(e,t){let n=[],r=e.length-1;for(let i=0;i<r;i++){let a=e[Math.max(0,i-1)],o=e[i],s=e[i+1],c=e[Math.min(r,i+2)];for(let e=0;e<t;e++){let r=e/t,i=r*r,l=i*r,u=e=>.5*(2*o[e]+(s[e]-a[e])*r+(2*a[e]-5*o[e]+4*s[e]-c[e])*i+(3*o[e]-a[e]-3*s[e]+c[e])*l);n.push([u(0),u(1),u(2)])}}return n.push([e[r][0],e[r][1],e[r][2]]),n}function $s(e,t,n=0){let r=e/2,i=t/2,a=[[r,-i],[r,i],[-r,i],[-r,-i]],o=[[0,1],[-1,0],[0,-1],[1,0]],s=[];for(let e=0;e<4;e++){let t=a[e],r=a[(e+1)%4],i=o[e],c=[i[1],-i[0]];if(s.push({id:e,pts:[[t[0]+i[0]*n,t[1]+i[1]*n],[r[0]-i[0]*n,r[1]-i[1]*n]],normals:[c,c]}),n>0){let t=o[(e+1)%4],a=[(i[1]+t[1])*Math.SQRT1_2,-(i[0]+t[0])*Math.SQRT1_2];s.push({id:4+e,pts:[[r[0]-i[0]*n,r[1]-i[1]*n],[r[0]+t[0]*n,r[1]+t[1]*n]],normals:[a,a]})}}return s}function ec(e,t){let n=[],r=[];for(let i=0;i<=t;i++){let a=i/t*Math.PI*2;r.push([Math.cos(a),Math.sin(a)]),n.push([e*Math.cos(a),e*Math.sin(a)])}return[{id:0,pts:n,normals:r}]}var tc=e=>{let t=Math.hypot(e[0],e[1],e[2])||1;return[e[0]/t,e[1]/t,e[2]/t]},nc=(e,t)=>[e[0]-t[0],e[1]-t[1],e[2]-t[2]],rc=(e,t)=>[e[1]*t[2]-e[2]*t[1],e[2]*t[0]-e[0]*t[2],e[0]*t[1]-e[1]*t[0]],ic=(e,t)=>e[0]*t[0]+e[1]*t[1]+e[2]*t[2];function ac(e,t,n,r){let i=t.length,a=i>2&&Math.hypot(...nc(t[0],t[i-1]))<1e-9,o=[0];for(let e=1;e<i;e++)o.push(o[e-1]+Math.hypot(...nc(t[e],t[e-1])));let s=o[i-1]||1,c=[],l=[],u=0;for(let e of n){c.push(e.v0??u),l.push(e.vDir??1);for(let t=1;t<e.pts.length;t++)u+=Math.hypot(e.pts[t][0]-e.pts[t-1][0],e.pts[t][1]-e.pts[t-1][1])}let d=[],f=[],p=[];for(let e=0;e<i;e++){let n=e>0?t[e-1]:a?t[i-2]:t[0],o=tc(nc(e<i-1?t[e+1]:a?t[1]:t[i-1],n)),s=tc(nc(r.up,[o[0]*ic(r.up,o),o[1]*ic(r.up,o),o[2]*ic(r.up,o)]));p.push(o),d.push(s),f.push(rc(o,s))}let m=n.map(()=>[]),h=n.map(e=>e.pts.length);for(let a=0;a<i;a++){let i=r.scale?r.scale(o[a]/s):1;for(let s=0;s<n.length;s++){let u=n[s],p=0;for(let n=0;n<u.pts.length;n++){n>0&&(p+=Math.hypot(u.pts[n][0]-u.pts[n-1][0],u.pts[n][1]-u.pts[n-1][1]));let[h,g]=u.pts[n],[_,v]=u.normals[n],y=[d[a][0]*_+f[a][0]*v,d[a][1]*_+f[a][1]*v,d[a][2]*_+f[a][2]*v];n===0&&r.onFace?.(e,u.id,y);let b=[t[a][0]+(d[a][0]*h+f[a][0]*g)*i,t[a][1]+(d[a][1]*h+f[a][1]*g)*i,t[a][2]+(d[a][2]*h+f[a][2]*g)*i];m[s].push(e.vertex(b,y,o[a],(c[s]+l[s]*p)*i))}}}for(let t=0;t<n.length;t++){let n=h[t];for(let r=0;r<i-1;r++)for(let i=0;i<n-1;i++){let a=m[t][r*n+i],o=m[t][r*n+i+1],s=m[t][(r+1)*n+i+1],c=m[t][(r+1)*n+i];e.quad(a,o,s,c)}}a||(r.capStart&&oc(e,t[0],d[0],f[0],p[0],-1,n,r.scale?r.scale(0):1),r.capEnd&&oc(e,t[i-1],d[i-1],f[i-1],p[i-1],1,n,r.scale?r.scale(1):1))}function oc(e,t,n,r,i,a,o,s){let c=[];for(let e of o)for(let t=0;t<e.pts.length-1;t++)c.push(e.pts[t]);let l=0,u=0;for(let e of c)l+=e[0],u+=e[1];l/=c.length,u/=c.length;let d=[i[0]*a,i[1]*a,i[2]*a],f=(i,a)=>e.vertex([t[0]+(n[0]*i+r[0]*a)*s,t[1]+(n[1]*i+r[1]*a)*s,t[2]+(n[2]*i+r[2]*a)*s],d,i,a),p=f(l,u),m=c.map(e=>f(e[0],e[1]));for(let t=0;t<m.length;t++)e.tri(p,m[t],m[(t+1)%m.length])}var sc=[[0,-.0015],[.013,-.0015],[.0135,-.001],[.0135,.002],[.0128,.0025],[.0101,.0025]],cc=[[0,.0025],[.01,.0025],[.01,.0056],[0,.0056]],lc=[[0,.0055],[.0136,.0055],[.0142,.0062],[.0142,.0148],[.0135,.0165],[.0118,.0175],[.0072,.0175],[.0062,.0182],[.006,.019],[.0045,.0195],[0,.0195]],uc=7e-4,dc=ns((e,t)=>.6+.4*is(.0055,.011,t));function fc(e,t){let n=Go[t];e.push(ro(n[0],0,n[2])),e.kind=F.MOTOR_BASE,e.a2=t,e.ao=.85,fo(e,sc,28,{hardAngle:.9}),e.kind=F.WIRE,e.a2=3,e.ao=.55,fo(e,cc,28,{hardAngle:.9}),e.kind=F.MOTOR_BELL,e.a2=t,e.ao=1,e.aoFn=dc,fo(e,lc,32,{hardAngle:.75}),e.aoFn=null,e.a2=0,e.pop()}function pc(e,t){let n=Go[t],r=-Math.sign(n[0])*Math.SQRT1_2,i=-Math.sign(n[2])*Math.SQRT1_2,a=(e,t,a)=>[n[0]+r*e-i*a,t,n[2]+i*e+r*a];e.kind=F.WIRE,e.a2=0,e.ao=.75;for(let t=0;t<3;t++){let n=(t-1)*.0016;ac(e,Qs([a(.012,.003,n),a(.016,2e-4,n),a(.024,-7e-4,n),a(.06,-7e-4,n),a(.078,-4e-4,n),a(.088,.003,n),a(.0909,.0065,n)],5),ec(uc,6),{up:[0,1,0]})}}function mc(e){for(let t=0;t<4;t++)fc(e,t),pc(e,t);e.ao=1}var hc=Xo.y1+5e-4,gc=[0,Xo.y1+.004,.0505],_c=$o.centre[1]+$o.half[1]+6e-4,vc=.0035,yc=ns((e,t)=>.55+.45*is(.034,.041,t));function bc(e){let t=[[.014700000000000001,_c-vc,0],[-.014700000000000001,_c-vc,1],[-.014700000000000001,.0334,2],[.014700000000000001,.0334,3]],n=[];for(let[r,i,a]of t)for(let t=0;t<=4;t++){let o=(a+t/4)*Math.PI/2;n.push([r+vc*Math.cos(o),i+vc*Math.sin(o),e])}return n.push(n[0]),n}function xc(e){e.kind=F.BATTERY,e.aoFn=yc,uo(e,$o.centre,$o.half,.0018),e.aoFn=null,e.kind=F.RUBBER,e.ao=.5,uo(e,[0,hc,0],[.0155,5e-4,.034],2e-4),e.ao=1,e.a2=1;for(let t of[-1,1])ac(e,bc(t*es),$s(.018,.0012,2e-4),{up:[0,0,1]});e.a2=0}function Sc(e){e.kind=F.PLASTIC,e.a2=1,uo(e,gc,[.0079,.004,.008],7e-4),e.a2=0,e.kind=F.WIRE;let t=$o.centre[2]+$o.half[2];for(let[n,r]of[[-1,0],[1,1]]){e.a2=r;let i=n*.004;ac(e,Qs([[i,.046,t-.001],[i,.043,t+.004],[i,gc[1],gc[2]-.008]],4),ec(.0013,7),{up:[0,1,0]}),ac(e,[[i,gc[1],gc[2]+.008],[i,gc[1]-.001,gc[2]+.0125]],ec(.0013,7),{up:[0,1,0],capEnd:!0})}e.a2=0}function Cc(e){xc(e),Sc(e)}function wc(e,t,n,r,i,a=4){let o=[],s=[[n-i,r-i],[-(n-i),r-i],[-(n-i),-(r-i)],[n-i,-(r-i)]];for(let n=0;n<4;n++)for(let r=0;r<=a;r++){let c=(n+r/a)*Math.PI/2;o.push([e+s[n][0]+i*Math.cos(c),t+s[n][1]+i*Math.sin(c)])}return o}function Tc(e,t,n,r){return Array.from({length:r},(i,a)=>[e+n*Math.cos(a/r*Math.PI*2),t+n*Math.sin(a/r*Math.PI*2)])}var Ec={y0:.008,y1:.0096},Dc={y0:.019,y1:.0206},Oc={y0:.0127,y1:.0143},kc=.01525,Ac=.046,jc={y:.0135,z0:.0555},Mc=[0,jc.y,jc.z0+.0085],Nc=ns((e,t)=>.75+.25*is(.006,.013,t)*(1-is(.02,.029,t)));function Pc(e,t,n,r,i){e.kind=F.PCB,e.a2=r,wo(e,t,i?[[-1,-1],[1,-1],[1,1],[-1,1]].map(([e,t])=>Tc(e*kc,t*kc,.0017,10)):[],n.y0,n.y1,{hardAngle:.7}),e.a2=0}function Fc(e,t,n,r,i){e.kind=t,e.a2=n,uo(e,r,i),e.a2=0}function Ic(e){e.aoFn=Nc,Pc(e,wc(0,.004,.018,.022,.003,3),Ec,0,!0),Pc(e,wc(0,0,.018,.018,.003,3),Dc,1,!0),e.aoFn=null,e.kind=F.ALU,e.ao=.8;for(let t of[-1,1])for(let n of[-1,1])e.push(ro(t*kc,0,n*kc)),fo(e,[[0,Yo.y1],[.0027,Yo.y1],[.0027,Xo.y0],[0,Xo.y0]],8,{hardAngle:.7}),e.pop();e.ao=1;for(let t=0;t<4;t++){let n=-.0075+t*.005;Fc(e,F.PLASTIC,2,[n,Ec.y1+8e-4,.008],[.002,8e-4,.003]),Fc(e,F.PLASTIC,2,[n,Ec.y1+8e-4,-.008],[.002,8e-4,.003])}Fc(e,F.PLASTIC,2,[.002,Dc.y1+4e-4,.002],[.0035,4e-4,.0035]),Fc(e,F.STEEL,0,[0,Dc.y1+.0014,-.0152],[.0037,.0014,.0028]),Fc(e,F.PLASTIC,3,[-.0095,Dc.y1+.0016,.0125],[.0022,.0016,.0032]),Fc(e,F.PLASTIC,3,[.0095,Dc.y1+.0016,.0125],[.0022,.0016,.0032]),e.kind=F.ALU,e.a2=2;let t=Ec.y1,n=.0216;e.push(ro(0,0,.0235)),fo(e,[[0,t],[.0044,t],[.0045,t+4e-4],[.0045,.021],[.0038,n],[0,n]],14,{hardAngle:.7}),e.pop(),e.a2=0}function Lc(e){Pc(e,wc(0,Ac,.0095,.0095,.002,2),Oc,2,!1),Fc(e,F.ALU,2,[0,.0155,Ac],[.0078,.0012,.0078]);for(let t=0;t<4;t++)Fc(e,F.ALU,2,[0,.0182,.041+t*.0033],[.0078,.0015,5e-4]);e.kind=F.STEEL;for(let t of[-1,1])e.push(ro(t*.0075,0,.0545)),fo(e,[[0,Yo.y1],[.0018,Yo.y1],[.0018,Oc.y0],[0,Oc.y0]],8,{hardAngle:.7}),e.pop();e.a2=1,e.push(no(ro(0,jc.y,jc.z0),ao(Math.PI/2))),fo(e,[[0,0],[.0035,0],[.0035,.0018],[.0022,.0018],[.0022,.0085],[0,.0085]],10,{hardAngle:.7}),e.pop(),e.a2=0}function Rc(e){e.kind=F.PLASTIC,e.a2=2;let[t,n,r]=Mc;ac(e,Qs([[t,n,r],[t,n-5e-4,r+.008],[t,n-.004,r+.022],[t,n-.012,r+.036],[t,n-.022,r+.046]],5),ec(.0024,8),{up:[0,1,0],capEnd:!0,scale:e=>e<.08?1.35:1}),e.a2=0}function zc(e){Ic(e),Lc(e),Rc(e)}var Bc=ks.map(Ko),Vc=Ko(As);function Hc(){let e=new so;return e.push(ro(-Bo[0],-Bo[1],-Bo[2])),Zs(e),mc(e),Cc(e),zc(e),Ps(e),e.pop(),e.finish()}function Uc(){return{ccw:zo(!1),cw:zo(!0)}}var Wc={albedo:[.03,.03,.034],roughness:.45,metalness:0},Gc={albedo:[.02,.02,.022],roughness:.6,metalness:0},Kc={albedo:[.9,.2,.02],roughness:.35,metalness:1},qc={albedo:[.02,.02,.02],roughness:.5,metalness:0},Jc=[0,0,0,1],Yc=ts.tilt/2,Xc=[Math.sin(Yc),0,0,Math.cos(Yc)];function Zc(e,t,n,r){let[i,a,o,s]=t,c=2*(a*n[2]-o*n[1]),l=2*(o*n[0]-i*n[2]),u=2*(i*n[1]-a*n[0]);e[0]=r[0]+n[0]+s*c+(a*u-o*l),e[1]=r[1]+n[1]+s*l+(o*c-i*u),e[2]=r[2]+n[2]+s*u+(i*l-a*c)}function Qc(e,t,n){e[0]=t[3]*n[0]+t[0]*n[3]+t[1]*n[2]-t[2]*n[1],e[1]=t[3]*n[1]-t[0]*n[2]+t[1]*n[3]+t[2]*n[0],e[2]=t[3]*n[2]+t[0]*n[1]-t[1]*n[0]+t[2]*n[3],e[3]=t[3]*n[3]-t[0]*n[0]-t[1]*n[1]-t[2]*n[2]}function $c(){let e=[],t=[],n=(n,r,i,a)=>{e.push({type:`obb`,center:[0,0,0],half:r,rot:[0,0,0,1],material:a}),t.push({a:Ko(n),b:n,q:i})},r=(n,r,i,a)=>{e.push({type:`capsule`,a:[0,0,0],b:[0,0,0],radius:i,material:a}),t.push({a:Ko(n),b:Ko(r),q:Jc})};n([0,.0132,0],[.0245,.0198,.055],Jc,Wc),n($o.centre,$o.half,Jc,Gc),n(ts.pos,[.0125,.0115,.0105],Xc,qc);for(let e of Go){let t=Math.sign(e[0]),n=Math.sign(e[2]);r([t*.026,-.004,n*.026],[e[0]-t*.004,-.004,e[2]-n*.004],.007,Wc),r([e[0],-.0015,e[2]],[e[0],.0195,e[2]],.0142,Kc)}return{prims:e,update(n,r){for(let i=0;i<e.length;i++){let a=e[i],o=t[i];a.type===`obb`?(Zc(a.center,r,o.a,n),Qc(a.rot,r,o.q)):a.type===`capsule`&&(Zc(a.a,r,o.a,n),Zc(a.b,r,o.b,n))}}}}var el=`quad`,tl={model:0,prevModel:16,hub:32,prop:48,spin:64,led:80,sprite:96,lens:116,floats:120};tl.floats;var nl=.006,rl=.003,il=.9,al=.002,ol=3,sl=()=>({...Ja(),COM_Y:Bo[1],PROP_R:To}),cl=()=>({PROP_R:To}),ll=[{shaderLocation:0,offset:0,format:`float32x3`},{shaderLocation:1,offset:12,format:`float32x3`},{shaderLocation:2,offset:24,format:`float32x2`},{shaderLocation:3,offset:32,format:`float32x4`}];function ul(e){let t=e.device,n=GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,r=t.createBindGroupLayout({label:`quad group 2`,entries:[{binding:0,visibility:n,buffer:{type:`uniform`}}]}),i=t.createPipelineLayout({bindGroupLayouts:[e.frame.layout,e.world.layout,r]}),a=e.module(`objects/quad.wgsl`,sl()),o=e.module(`objects/quad_forward.wgsl`,cl()),s=(e,n,r)=>t.createRenderPipeline({label:r,layout:i,vertex:{module:a,entryPoint:e,buffers:[{arrayStride:48,attributes:ll}]},fragment:{module:a,entryPoint:n,targets:It},primitive:{topology:`triangle-list`,cullMode:`back`},depthStencil:Lt}),c=s(`vsBody`,`fsBody`,`quad body`),l=s(`vsProp`,`fsProp`,`quad props`),u=(e,n,r,a)=>t.createRenderPipeline({label:r,layout:i,vertex:{module:o,entryPoint:e},fragment:{module:o,entryPoint:n,targets:[{format:Ft.hdr,blend:{color:a,alpha:{srcFactor:`zero`,dstFactor:`one`,operation:`add`}}}]},primitive:{topology:`triangle-list`,cullMode:`none`},depthStencil:zt}),d=u(`vsDisc`,`fsDisc`,`quad blur discs`,{srcFactor:`one`,dstFactor:`one-minus-src-alpha`,operation:`add`}),f=u(`vsSprite`,`fsSprite`,`quad glow sprites`,{srcFactor:`one`,dstFactor:`one`,operation:`add`}),p=(e,n)=>{let r=t.createBuffer({label:n,size:e.vertices.byteLength,usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST}),i=t.createBuffer({label:`${n} indices`,size:e.indices.byteLength,usage:GPUBufferUsage.INDEX|GPUBufferUsage.COPY_DST});return t.queue.writeBuffer(r,0,e.vertices),t.queue.writeBuffer(i,0,e.indices),{vertex:r,index:i,indexCount:e.indices.length}},m=Uc(),h=p(Hc(),`quad body`),g=p(m.cw,`quad props cw`),_=p(m.ccw,`quad props ccw`),v=(e,n)=>{let i=t.createBuffer({label:`${e} uniform`,size:tl.floats*4,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),a=t.createBindGroup({label:`${e} group 2`,layout:r,entries:[{binding:0,resource:{buffer:i}}]}),o=new Float32Array(tl.floats);for(let e=0;e<4;e++)o.set(qo[e],tl.hub+e*4),o.set(Jo[e],tl.prop+e*4),o.set(Bc[e],tl.sprite+e*4),o[tl.sprite+e*4+3]=nl,o.set(fs[e],tl.led+e*4);return o.set(Vc,tl.sprite+16),o[tl.sprite+19]=rl,o.set([0,Math.sin(ts.tilt),-Math.cos(ts.tilt),il],tl.lens),{uniform:i,group:a,data:o,rival:n,pose:xs(),rotors:_s(),visible:!1,showBlur:!1}},y=(e,n,r,i)=>{if(Ss(e.pose,n.pos,n.quat),vs(e.rotors,n.motorOmega,r.dt),e.visible=!i&&!Cs(r.camera.pos,n.pos),!e.visible)return;let{data:a,rotors:o}=e;a.set(e.pose.model,tl.model),a.set(e.pose.prevModel,tl.prevModel),e.showBlur=!1;let s=ys(n.armed,r.time);for(let t=0;t<4;t++){let n=tl.spin+t*4;a[n]=o.angle[t],a[n+1]=o.prevAngle[t],a[n+2]=o.solid[t],a[n+3]=o.blur[t],o.blur[t]>al&&(e.showBlur=!0),a[tl.led+t*4+3]=(t<2?us*(e.rival?ol:1):ds)*s}t.queue.writeBuffer(e.uniform,0,a)},b=e=>{e.setPipeline(l),e.setVertexBuffer(0,g.vertex),e.setIndexBuffer(g.index,`uint32`),e.drawIndexed(g.indexCount,2,0,0,0),e.setVertexBuffer(0,_.vertex),e.setIndexBuffer(_.index,`uint32`),e.drawIndexed(_.indexCount,2,0,0,2)},x=(e,t)=>{t.visible&&(e.setBindGroup(2,t.group),e.setPipeline(c),e.setVertexBuffer(0,h.vertex),e.setIndexBuffer(h.index,`uint32`),e.drawIndexed(h.indexCount),b(e))},S=(e,t)=>{t.visible&&(e.setBindGroup(2,t.group),t.showBlur&&(e.setPipeline(d),e.draw(6,4)),e.setPipeline(f),e.draw(6,5))},C=v(`quad`,!1),w=[],T=0,E=$c(),D=!1;return{update(t,n,r){let i=n.quad;if(!i){D&&e.rt.remove(el),D=!1,C.pose.valid=!1,C.visible=!1;return}E.update(i.pos,i.quat),e.rt.setDynamic(el,E.prims),D=!0,y(C,i,n,r)},updateRivals(e,t){for(;w.length<t.length;)w.push(v(`rival quad ${w.length}`,!0));T=t.length;for(let n=0;n<T;n++){let r=t[n];w[n].data.set(r.led,tl.led),w[n].data.set(r.led,tl.led+4),y(w[n],r.state,e,!1)}},encodeGBuffer(e){x(e,C);for(let t=0;t<T;t++)x(e,w[t])},encodeForward(e){S(e,C);for(let t=0;t<T;t++)S(e,w[t])},destroy(e){e.rt.remove(el);for(let e of[h,g,_])e.vertex.destroy(),e.index.destroy();for(let e of[C,...w])e.uniform.destroy()}}}function dl(e){let t=0,n=0;for(let r of e)t+=r.pts.length,n+=Math.max(0,r.pts.length-1);let r=new Float32Array(t*2*8),i=new Uint32Array(n*6),a=0,o=0;for(let t of e){let e=t.pts.length,n=a;for(let n=0;n<e;n++){let i=t.pts[Math.max(0,n-1)],o=t.pts[Math.min(e-1,n+1)],s=o[0]-i[0],c=o[1]-i[1],l=o[2]-i[2],u=Math.hypot(s,c,l)||1;for(let e of[-1,1])r.set([t.pts[n][0],t.pts[n][1],t.pts[n][2],s/u,c/u,l/u,e,t.gate],a*8),a++}for(let t=0;t<e-1;t++){let e=n+t*2;i.set([e,e+1,e+3,e,e+3,e+2],o),o+=6}}return{vertices:r,indices:i}}var fl=s,I=fl/2,pl=.01,ml=.0025,hl=.004,gl=64,_l=.02,vl=.7,yl=.45,bl=.2,xl=.012,Sl=0,Cl=1,wl=2,Tl=[F.GATE_FRAME,F.GATE_CHEVRON,F.GATE_LED],El=(e,t,n,r={})=>({id:e,pts:t,normals:t.map(()=>n),...r});function Dl(){let e=Math.SQRT1_2,t=I;return[El(Sl,[[t,-t+hl],[t,t-hl]],[1,0]),El(Sl,[[t,t-hl],[t-hl,t]],[e,e]),El(Cl,[[t-hl,t],[pl,t]],[0,1],{v0:t-hl,vDir:-1}),El(wl,[[pl,t],[pl,t+ml]],[1,0]),El(wl,[[pl,t+ml],[-.01,t+ml]],[0,1]),El(wl,[[-.01,t+ml],[-.01,t]],[-1,0]),El(Cl,[[-.01,t],[-t+hl,t]],[0,1],{v0:pl,vDir:1}),El(Sl,[[-t+hl,t],[-t,t-hl]],[-e,e]),El(Sl,[[-t,t-hl],[-t,-t+hl]],[-1,0]),El(Sl,[[-t,-t+hl],[-t+hl,-t]],[-e,-e]),El(Sl,[[-t+hl,-t],[t-hl,-t]],[0,-1]),El(Sl,[[t-hl,-t],[t,-t+hl]],[e,-e])]}function Ol(){let e=Math.PI*2/12,t=[];for(let n=0;n<12;n++){let r=(n-6)*e,i=r+e,a=Math.abs(r+e/2),o=a<Math.PI/6?wl:a<Math.PI/2?Cl:Sl,s=Math.PI/2+r,c=Math.PI/2+i,l=[[I*Math.cos(s),I*Math.sin(s)],[I*Math.cos(c),I*Math.sin(c)]],u=[[Math.cos(s),Math.sin(s)],[Math.cos(c),Math.sin(c)]],d=o===Cl?r>=0?{v0:I*(r-Math.PI/6),vDir:1}:{v0:I*(-Math.PI/6-r),vDir:-1}:{};t.push({id:o,pts:l,normals:u,...d})}return t}var kl=(e,t)=>[e[0]-t[0],e[1]-t[1],e[2]-t[2]],Al=(e,t)=>[e[1]*t[2]-e[2]*t[1],e[2]*t[0]-e[0]*t[2],e[0]*t[1]-e[1]*t[0]],jl=e=>{let t=Math.hypot(e[0],e[1],e[2])||1;return[e[0]/t,e[1]/t,e[2]/t]},Ml=(e,t,n,r,i=0)=>[e[0]+t.right[0]*n+t.up[0]*r+t.forward[0]*i,e[1]+t.right[1]*n+t.up[1]*r+t.forward[1]*i,e[2]+t.right[2]*n+t.up[2]*r+t.forward[2]*i];function Nl(e,n,r){let i=1/0;for(let[a,o]of t(e)){let t=Ml(e.pos,n,a,0,o);i=Math.min(i,r.heightAt(t[0],t[2]))}return i-e.pos[1]-E}function Pl(e,t,n,r,i,a=bl){let o=t.heightAt(r,i);e.kind=F.GATE_BASE,e.push(no(ro(r,o,i),io(n))),uo(e,[0,xl,0],[a,xl,a],.006),e.pop()}function Fl(e,t,n,r,i,a=bl,o=[0,0,-1]){let s=t.heightAt(r[0],r[2]);e.aoFn=(e,t)=>.5+.5*Math.min(1,Math.max(0,(t-s)/.6)),e.kind=F.GATE_FRAME,r[1]-s>.03&&ac(e,[[r[0],s-.05,r[2]],r],i,{up:o,capStart:!0,capEnd:!0,onFace:e=>e.kind=F.GATE_FRAME}),Pl(e,t,n,r[0],r[2],a),e.aoFn=null}function Il(e,t,n){let r=i(t),a=t.pos,o=t.width/2,s=t.height/2,c=(e,t,n=0)=>Ml(a,r,e,t,n),l=[],u=[];e.a3=t.index;let d=t.kind===`finish`,f=(n,r,i=!1,o=0,s=a)=>{let c=n.length>>1,l=kl(n[Math.min(n.length-1,c+1)],n[Math.max(0,c-1)]),f=n[c],p=Al(kl(s,f),l);ac(e,n,r,{up:p,capStart:n.length===2,capEnd:n.length===2,onFace:(e,t)=>{e.kind=d&&i&&t===Sl?F.GATE_CHECKER:Tl[t]}});let m=jl(p),h=n.length>2&&n[0]===n[n.length-1],g=n.map((e,t)=>{let r=jl(Al(kl(n[h?(t+1)%(n.length-1):Math.min(t+1,n.length-1)],n[h?(t+n.length-2)%(n.length-1):Math.max(t-1,0)]),m));return[e[0]+r[0]*(I+o),e[1]+r[1]*(I+o),e[2]+r[2]*(I+o)]});u.push({gate:t.index,pts:g})},p=Dl(),h=$s(fl,fl,hl),g=(e=0)=>{let t=c(0,0,e),n=s+fl;for(let r of[-1,1])f([c(r*(o+I),-n,e),c(r*(o+I),n,e)],p,!1,ml,t);f([c(-o,s+I,e),c(o,s+I,e)],p,!0,ml,t),f([c(-o,-s-I,e),c(o,-s-I,e)],p,!1,ml,t)},_=(t,n,i,o,s,c,l=.01)=>{e.push(oo(r.right,r.up,[-r.forward[0],-r.forward[1],-r.forward[2]],a)),uo(e,[(t+n)/2,(i+o)/2,-(s+c)/2],[(n-t)/2,(o-i)/2,(c-s)/2],l),e.pop()};switch(t.kind){case`arch`:{let i=b(t),a=o+I,l=v(t,r,i);for(let r=0;r<2;r++){let o=r===0?-1:1;f([c(o*a,-s),c(o*a,i)],p,!1,ml),Fl(e,n,t.yaw,c(l[r][0],l[r][1]),h)}let u=[];for(let e=0;e<=gl/2;e++){let t=e/(gl/2)*Math.PI;u.push(c(a*Math.cos(t),i+a*Math.sin(t)))}f(u,p,!1,ml);break}case`hoop`:case`dive`:case`drop`:{let r=[];for(let e=0;e<=gl;e++){let t=e/gl*Math.PI*2;r.push(c((o+I)*Math.cos(t),(s+I)*Math.sin(t)))}if(r[gl]=r[0],f(r,Ol()),t.kind===`drop`){let r=m(t),i=c(r.end[0],r.end[1]);e.kind=F.GATE_FRAME,ac(e,[c(r.rim[0]-I,r.rim[1]),i],h,{up:[0,1,0],capStart:!0,capEnd:!0,onFace:e=>e.kind=F.GATE_FRAME}),Fl(e,n,t.yaw,i,h,.3)}else Fl(e,n,t.yaw,r.reduce((e,t)=>t[1]<e[1]?t:e),h);break}case`flag`:{let r=a[1]+s+.3;for(let i of[-1,1]){let a=c(i*(o+_l),0);Rl(e,a[0],n.heightAt(a[0],a[2]),r,a[2],_l,F.FLAGPOLE),l.push({pos:[a[0],r-.03,a[2]],width:vl,height:yl,colour:Za(t.index),seed:t.index*2+ +(i>0)})}break}case`window`:{g();let i=x(t),c=Math.min(Nl(t,r,n),-s-fl-.05),l=pe/2;e.push(oo(r.right,r.forward,r.up,a)),e.kind=F.GATE_PANEL,e.a2=eo(o+fl,s+fl),e.aoFn=(e,t)=>.6+.4*Math.min(1,Math.max(0,(t-(a[1]+c+E))/.8)),wo(e,[[-i.half,c],[i.half,c],[i.half,i.top],[-i.half,i.top]],[[[-o-fl,-s-fl],[-o-fl,s+fl],[o+fl,s+fl],[o+fl,-s-fl]]],-l,l,{wallKind:F.GATE_BASE,hardAngle:.3}),e.aoFn=null,e.a2=0,e.pop();break}case`tunnel`:{let i=he(t);g(0),g(i.depth);let l=Nl(t,r,n);e.kind=F.GATE_PANEL,e.aoFn=(e,t)=>.55+.45*Math.min(1,Math.max(0,(t-(a[1]+l+E))/.8));for(let e of[-1,1])_(e<0?-i.outer:i.inner,e<0?-i.inner:i.outer,l,i.roofTop,I,i.depth-I);if(_(-i.outer,i.outer,i.roof,i.roofTop,I,i.depth-I),e.kind=F.GATE_BASE,-s-fl-l>.02)for(let e of[0,i.depth])_(-o,o,l,-s-fl,e-I*.8,e+I*.8,.004);e.aoFn=null,f([c(0,s+I,.3),c(0,s+I,i.depth-.3)],p,!1,ml,c(0,0,i.depth/2));break}case`ladder`:g();break;case`hurdle`:{let r=s+fl;for(let i of[-1,1]){let s=c(i*(o+I),r),l=n.heightAt(s[0],s[2])-.05-a[1];f([c(i*(o+I),l),s],p,!1,ml),e.aoFn=(e,t)=>.5+.5*Math.min(1,Math.max(0,(t-a[1]-l)/.6)),Pl(e,n,t.yaw,s[0],s[2]),e.aoFn=null}f([c(-o,s+I),c(o,s+I)],p,!0,ml),f([c(-o,-s-I),c(o,-s-I)],p,!0,ml);break}default:g();for(let[i,a]of ne(t,r))Fl(e,n,t.yaw,c(i,a),h)}return e.a3=0,{flags:l,strips:u}}function Ll(e,t,n,r){let a=t[n.top],o=i(a);e.a3=a.index;let s=$s(j,j,.008);for(let t of[-1,1]){let i=Ml(a.pos,o,t*n.railU,0);Fl(e,r,a.yaw,[i[0],n.railTop,i[2]],s,.25,o.right)}e.a3=0}function Rl(e,t,n,r,i,a,o){e.kind=o,e.push(ro(t,0,i)),fo(e,[[0,n-.05],[a,n-.05],[a,r-a*.5],[a*.75,r],[0,r+a*.4]],10,{polar:!0}),e.pop()}function zl(e){let t=Math.imul(e|0,2654435761)^2246822507;return t=Math.imul(t^t>>>15,739982445),t=Math.imul(t^t>>>12,695872825),((t^t>>>15)>>>0)/4294967296}function Bl(e,t,n,r){let i=Math.floor(e),a=Math.floor(t),o=Math.floor(n),s=e-i,c=t-a,l=n-o,u=s*s*(3-2*s),d=c*c*(3-2*c),f=l*l*(3-2*l),p=(e,t,n)=>zl(r*7919+(i+e)*73856093+(a+t)*19349663+(o+n)*83492791),m=(e,t,n)=>e+(t-e)*n;return m(m(m(p(0,0,0),p(1,0,0),u),m(p(0,1,0),p(1,1,0),u),d),m(m(p(0,0,1),p(1,0,1),u),m(p(0,1,1),p(1,1,1),u),d),f)*2-1}var Vl=(e,t,n)=>{e.aoFn=(e,r)=>.55+.45*Math.min(1,Math.max(0,(r-t)/n))};function Hl(e,t){let n=t.size[0],r=t.size[1];e.kind=F.CONE,e.a2=r,fo(e,[[.74*n,.02],[.2*n,r-.02],[.1*n,r-.006],[.06*n,r],[0,r]],18,{polar:!0}),e.a2=0,e.kind=F.CONE,e.a3=1,uo(e,[0,.01,0],[n,.01,n],.006),e.a3=0}function Ul(e,t,n){let[r,i,a]=t.size;e.kind=F.WALL,e.a2=n,Vl(e,t.pos[1],.5),uo(e,[0,(i-.15)/2,0],[r/2,(i+.15)/2,a/2],.012),e.a2=0}function Wl(e,t,n){let[r,i,a]=t.size,o=r*.5,s=i*.62,c=a*.5,l=i*.4;e.kind=F.ROCK,e.a2=zl(n),Vl(e,t.pos[1],i*.5),po(e,(e,t)=>{let r=e*Math.PI*2,a=t*Math.PI,u=Math.sin(a)*Math.cos(r),d=Math.cos(a),f=Math.sin(a)*Math.sin(r),p=.88+.12*Bl(u*1.7,d*1.7,f*1.7,n)+.05*Bl(u*5,d*5,f*5,n+3);return[o*u*p,Math.max(l+s*d*p,-.08*i),c*f*p]},20,12,{wrapU:!0,uvScale:[r*1.5,i]}),e.a2=0}function Gl(e,t){let n=t.size[0],r=t.size[1];e.kind=F.TRUNK,fo(e,[[0,-.1],[n*.6,-.1],[n*.5,.5],[0,.55]],8,{polar:!0}),e.vertex([0,-.1,0],[0,1,0]),e.vertex([0,r*.9,0],[0,1,0])}function Kl(e,t,n,r,i=8){let a=[n[0]-t[0],n[1]-t[1],n[2]-t[2]],o=Math.abs(a[1])>.9*Math.hypot(a[0],a[1],a[2])?[1,0,0]:[0,1,0];ac(e,[t,n],ec(r,i),{up:o,capStart:!0,capEnd:!0})}function ql(e,t,n,r){let i=[n[0]-t[0],n[1]-t[1],n[2]-t[2]],a=Math.abs(i[1])>.9*Math.hypot(i[0],i[1],i[2])?[1,0,0]:[0,1,0];ac(e,[t,n],$s(r,r,r*.08),{up:a,capStart:!0,capEnd:!0})}function Jl(e,t,n,r,i,a,o,s=.01){let c=[Math.abs(i-t)/2,Math.abs(a-n)/2,Math.abs(o-r)/2];uo(e,[(t+i)/2,(n+a)/2,(r+o)/2],c,Math.min(s,c[0]*.5,c[1]*.5,c[2]*.5))}var Yl=.3,Xl=.035;function Zl(e,t,n,r){let i=Math.hypot(n[0]-t[0],n[1]-t[1]),a=[(n[0]-t[0])/i,(n[1]-t[1])/i],o=Math.floor((i-.3)/Yl),s=(i-o*Yl)/2,c=(e,n)=>[t[0]+a[0]*e+r[0]*n,t[1]+a[1]*e+r[1]*n];e.push(c(0,0));for(let t=0;t<o;t++){let n=s+t*Yl;e.push(c(n+.045,0),c(n+.095,Xl),c(n+.205,Xl),c(n+.255,0))}}function Ql(e,t,n,i){let[a,,o]=t.size,{n:s,height:c}=r(t),l=a/2,u=o/2,d=.01;Vl(e,t.pos[1],.6);let f=fe(t,i);f<-.06&&(e.kind=F.CONCRETE,e.a2=0,Jl(e,-l+.04,f,-u+.04,l-.04,.02,u-.04,.02));for(let t=0;t<s;t++){let r=t*c,i=r+c;e.kind=F.CONTAINER,e.a2=(Math.floor(zl(n*3+1)*Qa.length)+t*3)%Qa.length;let a=[];Zl(a,[-l+d,-u+d],[l-d,-u+d],[0,1]),a.push([l-d,-u+d],[l-d,-u+.16],[l-.05,-u+.16],[l-.05,u-.16],[l-d,u-.16]),Zl(a,[l-d,u-d],[-l+d,u-d],[0,-1]),Zl(a,[-l+d,u-d],[-l+d,-u+d],[1,0]),wo(e,a,[],r+.01,i-.02,{hardAngle:.3});for(let t of[-1,1])for(let n of[-1,1])Jl(e,t*(l-.16),r,n*(u-.16),t*l,i,n*u,.01);for(let t of[-1,1])for(let n of[r,i-.11])Jl(e,-l+.16,n,t*(u-.005),l-.16,n+.11,t*(u-.12),.008);for(let t of[-1,1])for(let n of[r,i-.11])Jl(e,t*(l-.005),n,-u+.16,t*(l-.14),n+.11,u-.16,.008);e.kind=F.STEEL_PAINT,e.a2=0;for(let t of[-.9,-.3,.3,.9])Kl(e,[l-.03,r+.12,t*u],[l-.03,i-.12,t*u],.017,6)}e.a2=0}function $l(e,t,n){let[r,i,a]=t.size;Vl(e,t.pos[1],1),e.kind=F.HAZARD,Jl(e,-r/2,Math.min(-.15,fe(t,n)),-a/2,r/2,1.2,a/2,.02),e.kind=F.CONCRETE,e.a2=0,Jl(e,-r/2,1.2,-a/2,r/2,i,a/2,.025)}function eu(e,t,r){let i=n(t),[a,,o]=t.size;e.kind=F.STEEL_PAINT,e.a2=3;for(let n of[-1,1]){let a=n*i.postX,o=r(a,0,i.post/2,i.post/2);Vl(e,t.pos[1]+o,.8),Jl(e,a-i.post/2,o,-i.post/2,a+i.post/2,i.y0,i.post/2,.015)}e.aoFn=null,e.kind=F.HAZARD,Jl(e,-a/2,i.y0,-o/2,a/2,i.top,o/2,.02),e.a2=0}function tu(e,t,n){let r=y(t),[i,,a]=t.size,o=.3;e.kind=F.CONCRETE;for(let i of[-1,1]){let a=i*r.pierX,o=n(a,0,M/2,r.pierZ);e.a2=2,Vl(e,t.pos[1]+o,1.5),Jl(e,a-M/2+.1,o,-r.pierZ+.25,a+M/2-.1,r.under-.4,r.pierZ-.25,.03),e.aoFn=null,e.a2=0,Jl(e,a-M/2,r.under-.4,-r.pierZ,a+M/2,r.under,r.pierZ,.03)}e.a2=0;for(let t of[-a/3,0,a/3])Jl(e,-i/2,r.under,t-.22,i/2,r.top-o,t+.22,.02);e.a2=1,Jl(e,-i/2,r.top-o,-a/2+ie,i/2,r.top,a/2-ie,.02),e.a2=2;for(let t of[-1,1])Jl(e,-i/2,r.top-o,t*(a/2-ie),i/2,r.top+1,a/2*t,.03);e.a2=0}function nu(e,t,n){let r=a(t),[i,o,s]=t.size,c=w/2;e.kind=F.STEEL_PAINT,e.a2=0;for(let t of[-r.poleZ,r.poleZ])for(let i of r.poles){let r=n(i,t,c,c);Kl(e,[i,r,t],[i,o,t],c),e.kind=F.GATE_BASE,Jl(e,i-.075,r,t-.075,i+.075,r+.012,t+.075,.004),e.kind=F.STEEL_PAINT}let l=e=>e-.04-c;for(let t of r.decks){for(let n of[-r.poleZ,r.poleZ])Kl(e,[-i/2,l(t),n],[i/2,l(t),n],c);for(let n of r.poles)Kl(e,[n,l(t)-w*.5,-s/2],[n,l(t)-w*.5,s/2],c*.9)}for(let t of r.rails)for(let n of[-r.poleZ,r.poleZ])Kl(e,[-i/2,t,n],[i/2,t,n],c);e.kind=F.WALL,e.a2=0;let u=(s-.04)/4;for(let t of r.decks)for(let n=0;n<4;n++){let r=-s/2+.02+n*u;Jl(e,-i/2+.01,t-.04,r+.006,i/2-.01,t,r+u-.006,.006)}e.a2=0}function ru(e,t,n){let r=c(t),[,i]=t.size,a=d(r),o=(e,t,n)=>{let i=Math.min(1,Math.max(0,n/r.platform));return[e*(r.base[0]+(r.top[0]-r.base[0])*i),n,t*(r.base[1]+(r.top[1]-r.base[1])*i)]},s=[[-1,-1],[1,-1],[1,1],[-1,1]];e.kind=F.STEEL_PAINT;for(let t=0;t<a;t++){let i=r.platform*t/a,c=r.platform*(t+1)/a;e.a2=t%2==0?1:2;for(let[a,l]of s){let s=t===0?n(a*r.base[0],l*r.base[1],de/2,de/2):i,u=o(a,l,i);ql(e,[u[0],s,u[2]],o(a,l,c),de)}e.a2=0;for(let t=0;t<4;t++){let[n,r]=s[t],[a,l]=s[(t+1)%4];ql(e,o(n,r,c),o(a,l,c),.09),ql(e,o(n,r,i+.1),o(a,l,c-.1),.06),ql(e,o(a,l,i+.1),o(n,r,c-.1),.06)}}let[l,u]=r.deck,f=r.platform+.15;e.kind=F.STEEL_PAINT,e.a2=0,Jl(e,-l,r.platform,-u,l,f,u,.02);for(let[t,n]of s)Kl(e,[t*(l-.03),f,n*(u-.03)],[t*(l-.03),f+me,n*(u-.03)],.025);for(let t of[f+me*.5,f+me-.03])for(let n=0;n<4;n++){let[r,i]=s[n],[a,o]=s[(n+1)%4];Kl(e,[r*(l-.03),t,i*(u-.03)],[a*(l-.03),t,o*(u-.03)],.022)}e.a2=1,Rl(e,0,f,i,0,.07,F.STEEL_PAINT),e.a2=0}function iu(e,t,n,r,i){let a=io(t.yaw);e.push(no(ro(t.pos[0],t.pos[1],t.pos[2]),a));let o=e.aoFn,s=A(t,i);switch(t.kind){case`container`:Ql(e,t,n,s);break;case`pillar`:$l(e,t,s);break;case`beam`:eu(e,t,s);break;case`bridge`:tu(e,t,s);break;case`scaffold`:nu(e,t,s);break;case`tower`:ru(e,t,s);break;case`cone`:Hl(e,t);break;case`wall`:Ul(e,t,Math.floor(zl(n)*4));break;case`rock`:Wl(e,t,n+11);break;case`tree`:Gl(e,t);break;case`pole`:Rl(e,0,0,t.size[1],0,t.size[0],F.POLE);break;case`flagpole`:Rl(e,0,0,t.size[1],0,t.size[0],F.FLAGPOLE)}e.pop(),e.aoFn=o,t.kind===`flagpole`&&r.push({pos:[t.pos[0],t.pos[1]+t.size[1]-.03,t.pos[2]],width:.95,height:.6,colour:[.85,.04,.03],seed:n})}var au=1.2,ou=.024,su=.07;function cu(e,t,n){let[r,,i]=t.start.pos,a=t.start.yaw,o=Math.cos(a),s=Math.sin(a),c=au/2,l=1/0,u=-1/0;for(let[e,t]of[[0,0],[c,c],[-.6,c],[-.6,-.6],[c,-.6]]){let a=n.heightAt(r+o*e+s*t,i-s*e+o*t);l=Math.min(l,a),u=Math.max(u,a)}e.kind=F.PAD,e.push(no(ro(r,0,i),io(a))),wo(e,wc(0,0,c,c,su),[],l-.03,u+ou,{wallKind:F.PAD_EDGE}),e.pop()}function lu(e,t){let n=new so,r=[],i=[];for(let a of e.gates){let e=Il(n,a,t);r.push(...e.flags),i.push(...e.strips)}for(let r of te(e.gates))Ll(n,e.gates,r,t);return e.obstacles.forEach((e,i)=>iu(n,e,i,r,t)),cu(n,e,t),{mesh:n.finish(),flags:r,strips:i}}var L=s/2,uu=64,du={albedo:[.6,.6,.62],roughness:.4,metalness:.8},fu={albedo:[.35,.28,.2],roughness:.85,metalness:0},pu={albedo:[.3,.29,.27],roughness:.95,metalness:0},mu={albedo:[.12,.09,.06],roughness:.95,metalness:0},hu={albedo:[1,.25,.02],roughness:.5,metalness:0},gu={albedo:[.05,.05,.05],roughness:.8,metalness:0},_u={albedo:[.55,.55,.53],roughness:.7,metalness:0},vu={albedo:[.4,.39,.37],roughness:.9,metalness:0},yu={albedo:[.32,.24,.02],roughness:.5,metalness:0},bu={albedo:[.3,.17,.08],roughness:.85,metalness:0},xu=e=>({albedo:$a[e],roughness:.45,metalness:e===0?.8:0});function Su(e,t,n){let r=e[0]+t[1]+n[2];if(r>0){let i=Math.sqrt(r+1)*2;return[(t[2]-n[1])/i,(n[0]-e[2])/i,(e[1]-t[0])/i,i/4]}if(e[0]>t[1]&&e[0]>n[2]){let r=Math.sqrt(1+e[0]-t[1]-n[2])*2;return[r/4,(t[0]+e[1])/r,(n[0]+e[2])/r,(t[2]-n[1])/r]}if(t[1]>n[2]){let r=Math.sqrt(1+t[1]-e[0]-n[2])*2;return[(t[0]+e[1])/r,r/4,(n[1]+t[2])/r,(n[0]-e[2])/r]}let i=Math.sqrt(1+n[2]-e[0]-t[1])*2;return[(n[0]+e[2])/i,(n[1]+t[2])/i,i/4,(e[1]-t[0])/i]}var Cu=e=>[0,Math.sin(e/2),0,Math.cos(e/2)];function wu(e,n,r,a){let o=i(e),c=e.pos,l=e.width/2,u=e.height/2,d=s,f={albedo:Za(e.index),roughness:.45,metalness:0},p=Su(o.right,o.up,[-o.forward[0],-o.forward[1],-o.forward[2]]),h=(e,t,n=0)=>[c[0]+o.right[0]*e+o.up[0]*t+o.forward[0]*n,c[1]+o.right[1]*e+o.up[1]*t+o.forward[1]*n,c[2]+o.right[2]*e+o.up[2]*t+o.forward[2]*n],g=(e,t,n,r)=>{a.push({type:`obb`,center:h(e,t),half:[n,r,L],rot:p,material:f})},_=(e,t,n,r,i,o,s)=>{t-e<1e-6||r-n<1e-6||o-i<1e-6||a.push({type:`obb`,center:h((e+t)/2,(n+r)/2,(i+o)/2),half:[(t-e)/2,(r-n)/2,(o-i)/2],rot:p,material:s})},y=(t,i,o=L)=>{let s=n.heightAt(t[0],t[2]),c=t[1]-s+.05;c>.02&&a.push({type:`obb`,center:[t[0],s-.05+c/2,t[2]],half:[o,c/2,o],rot:Cu(e.yaw),material:f}),i&&r.plates&&a.push({type:`obb`,center:[t[0],s+.012,t[2]],half:[.2,.012,.2],rot:Cu(e.yaw),material:gu})},S=(e,t,n,r,i,o)=>{for(let s=0;s<o;s++){let c=r+(i-r)*s/o,l=r+(i-r)*(s+1)/o;a.push({type:`capsule`,a:h(e*Math.cos(c),n+t*Math.sin(c)),b:h(e*Math.cos(l),n+t*Math.sin(l)),radius:L,material:f})}},C=()=>{for(let e of[-1,1])g(e*(l+L),0,L,u+d);g(0,u+L,l,L),g(0,-u-L,l,L)},w=()=>{let r=1/0;for(let[i,a]of t(e)){let e=h(i,0,a);r=Math.min(r,n.heightAt(e[0],e[2]))}return r-c[1]-E};switch(e.kind){case`arch`:{let t=b(e),n=l+L,i=v(e,o,t);for(let e=0;e<2;e++){let r=e===0?-1:1;a.push({type:`capsule`,a:h(r*n,-u),b:h(r*n,t),radius:L,material:f}),y(h(i[e][0],i[e][1]),!1)}S(n,n,t,0,Math.PI,Math.max(4,r.ring>>1));break}case`hoop`:case`dive`:case`drop`:{if(S(l+L,u+L,0,0,Math.PI*2,r.ring),e.kind===`drop`){let t=m(e),n=h(t.end[0],t.end[1]);a.push({type:`capsule`,a:h(t.rim[0],t.rim[1]),b:n,radius:L,material:f}),y(n,!0);break}let t=h(0,-(u+L));for(let e=0;e<uu;e++){let n=e/uu*Math.PI*2,r=h((l+L)*Math.cos(n),(u+L)*Math.sin(n));r[1]<t[1]-1e-6&&(t=r)}y(t,!1);break}case`flag`:{let e=c[1]+u+.3;for(let t of[-1,1]){let r=h(t*(l+.02),0);a.push({type:`capsule`,a:[r[0],n.heightAt(r[0],r[2]),r[2]],b:[r[0],e,r[2]],radius:.02,material:du})}break}case`window`:{let t=x(e),n=w(),r=pe/2;for(let e of[-1,1])_(e<0?-t.half:l,e<0?-l:t.half,n,t.top,-r,r,_u);_(-l,l,u,t.top,-r,r,_u),_(-l,l,n,-u,-r,r,_u);break}case`tunnel`:{let t=he(e),n=w();for(let e of[-1,1])_(e<0?-t.outer:t.inner,e<0?-t.inner:t.outer,n,t.roofTop,0,t.depth,_u);_(-t.outer,t.outer,t.roof,t.roofTop,0,t.depth,_u);for(let e of[0,t.depth])_(-l-d,l+d,n,-u,e-L,e+L,f);break}case`ladder`:C();break;case`hurdle`:for(let e of[-1,1])y(h(e*(l+L),u+d),!0);g(0,u+L,l,L),g(0,-u-L,l,L);break;default:C();for(let[t,n]of ne(e,o))y(h(t,n),!0)}}function Tu(e,t,n){for(let r of te(e.gates)){let a=e.gates[r.top],o=i(a),s={albedo:Za(a.index),roughness:.45,metalness:0};for(let e of[-1,1]){let i=a.pos[0]+o.right[0]*e*r.railU,c=a.pos[2]+o.right[2]*e*r.railU,l=t.heightAt(i,c),u=r.railTop-l+.05;u>.02&&n.push({type:`obb`,center:[i,l-.05+u/2,c],half:[j/2,u/2,j/2],rot:Cu(a.yaw),material:s})}}}function Eu(e){let[t,n,r]=e.pos,[i,a,o]=e.size;switch(e.kind){case`wall`:return{type:`obb`,center:[t,n+a/2,r],half:[i/2,a/2,o/2],rot:Cu(e.yaw),material:fu};case`rock`:return{type:`obb`,center:[t,n+a*.4,r],half:[i*.45,a*.4,o*.45],rot:Cu(e.yaw),material:pu};case`tree`:return{type:`capsule`,a:[t,n,r],b:[t,n+a*.7,r],radius:i,material:mu};case`cone`:return{type:`capsule`,a:[t,n+.1,r],b:[t,n+a-.1,r],radius:.1,material:hu};default:return{type:`capsule`,a:[t,n,r],b:[t,n+a,r],radius:i,material:du}}}function Du(e,t,n,r){let i=Cu(e.yaw),a=A(e,t);if(e.kind===`tower`){let t=c(e),n=xu(1);for(let i of[-1,1])for(let o of[-1,1]){let s=a(i*t.base[0],o*t.base[1],de/2,de/2);r.push({type:`capsule`,a:h(e,i*t.base[0],s,o*t.base[1]),b:h(e,i*t.top[0],t.platform,o*t.top[1]),radius:de*.6,material:n})}r.push({type:`obb`,center:h(e,0,t.platform+.075,0),half:[t.deck[0],.075,t.deck[1]],rot:i,material:xu(0)}),r.push({type:`capsule`,a:h(e,0,t.platform,0),b:h(e,0,e.size[1],0),radius:.07,material:n});return}let o={albedo:Qa[Math.floor(zl(n*3+1)*Qa.length)],roughness:.55,metalness:.3};for(let t of p(e,a)){let n;switch(e.kind){case`container`:n=o;break;case`pillar`:case`bridge`:n=vu;break;case`beam`:n=t.role===`support`?xu(3):yu;break;default:n=t.role===`deck`?bu:xu(0)}e.kind===`scaffold`&&t.role===`support`?r.push({type:`capsule`,a:h(e,t.c[0],t.c[1]-t.h[1],t.c[2]),b:h(e,t.c[0],t.c[1]+t.h[1],t.c[2]),radius:t.h[0],material:n}):r.push({type:`obb`,center:h(e,t.c[0],t.c[1],t.c[2]),half:t.h,rot:i,material:n})}}var Ou=[`bridge`,`tower`,`container`,`pillar`,`beam`,`wall`,`scaffold`,`rock`,`tree`,`pole`,`flagpole`,`cone`],ku=[{ring:24,plates:!0},{ring:12,plates:!0},{ring:8,plates:!0},{ring:6,plates:!0},{ring:6,plates:!1}];function Au(t,n,r=300){let i=[];for(let e of ku){i=[];for(let r of t.gates)wu(r,n,e,i);if(Tu(t,n,i),i.length<=r*.7)break}let a=0,o=[];for(let s of Ou)for(let c=0;c<t.obstacles.length;c++){let l=t.obstacles[c];if(l.kind===s){if(i.length>=r)return i;if(s===`cone`&&++a>60)break;if(!e(s)){i.push(Eu(l));continue}o.length=0,Du(l,n,c,o),i.length+o.length<=r&&i.push(...o)}}return i.length>r?i.slice(0,r):i}var ju=24,Mu=14,Nu=.5,Pu=`track`;function Fu(){let e=new Float32Array(750);for(let t=0;t<=Mu;t++)for(let n=0;n<=ju;n++)e.set([n/ju,t/Mu],(t*25+n)*2);let t=new Uint16Array(2016),n=0;for(let e=0;e<Mu;e++)for(let r=0;r<ju;r++){let i=e*25+r;t.set([i,i+1,i+ju+2,i,i+ju+2,i+ju+1],n),n+=6}return{vertices:e,indices:t}}function Iu(e){let t=e.device,n=GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,r=t.createBindGroupLayout({label:`track group 2`,entries:[{binding:0,visibility:n,buffer:{type:`uniform`}},{binding:1,visibility:n,buffer:{type:`read-only-storage`}},{binding:2,visibility:n,buffer:{type:`read-only-storage`}}]}),i=t.createPipelineLayout({bindGroupLayouts:[e.frame.layout,e.world.layout,r]}),a=e.module(`objects/track.wgsl`,Ja()),o=e.module(`objects/glow.wgsl`),s=null,c=null,l=null,u=t.createRenderPipelineAsync({label:`track static`,layout:i,vertex:{module:a,entryPoint:`vs`,buffers:[{arrayStride:48,attributes:[{shaderLocation:0,offset:0,format:`float32x3`},{shaderLocation:1,offset:12,format:`float32x3`},{shaderLocation:2,offset:24,format:`float32x2`},{shaderLocation:3,offset:32,format:`float32x4`}]}]},fragment:{module:a,entryPoint:`fs`,targets:It},primitive:{topology:`triangle-list`,cullMode:`back`},depthStencil:Lt}),d=t.createRenderPipelineAsync({label:`track cloth`,layout:i,vertex:{module:a,entryPoint:`vsCloth`,buffers:[{arrayStride:8,attributes:[{shaderLocation:0,offset:0,format:`float32x2`}]}]},fragment:{module:a,entryPoint:`fsCloth`,targets:It},primitive:{topology:`triangle-list`,cullMode:`none`},depthStencil:Lt}),f=t.createRenderPipelineAsync({label:`track glow`,layout:i,vertex:{module:o,entryPoint:`vsGlow`,buffers:[{arrayStride:32,attributes:[{shaderLocation:0,offset:0,format:`float32x3`},{shaderLocation:1,offset:12,format:`float32x3`},{shaderLocation:2,offset:24,format:`float32x2`}]}]},fragment:{module:o,entryPoint:`fsGlow`,targets:[{format:Ft.hdr,blend:{color:{srcFactor:`one`,dstFactor:`one`,operation:`add`},alpha:{srcFactor:`zero`,dstFactor:`one`,operation:`add`}}}]},primitive:{topology:`triangle-list`,cullMode:`none`},depthStencil:zt}),p=Promise.all([u,d,f]).then(([e,t,n])=>{s=e,c=t,l=n}),m=t.createBuffer({label:`track uniform`,size:32,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),h=new Float32Array(8),g=Fu(),_=t.createBuffer({label:`cloth grid`,size:g.vertices.byteLength,usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST}),v=t.createBuffer({label:`cloth indices`,size:g.indices.byteLength,usage:GPUBufferUsage.INDEX|GPUBufferUsage.COPY_DST});t.queue.writeBuffer(_,0,g.vertices),t.queue.writeBuffer(v,0,g.indices);let y=null,b=null,x=null,S=null,C=null,w=0,T=new Float32Array(8),E=0,D=!1,O=-1,k=new Set,A=new Map,j=NaN,M=[1,0,3],ee=(e,n)=>{if(e.indices.length===0)return null;let r=t.createBuffer({label:n,size:e.vertices.byteLength,usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST}),i=t.createBuffer({label:`${n} indices`,size:e.indices.byteLength,usage:GPUBufferUsage.INDEX|GPUBufferUsage.COPY_DST});return t.queue.writeBuffer(r,0,e.vertices),t.queue.writeBuffer(i,0,e.indices),{vertex:r,index:i,indexCount:e.indices.length}},te=()=>{S?.vertex.destroy(),S?.index.destroy(),C?.vertex.destroy(),C?.index.destroy(),b?.destroy(),x?.destroy(),S=C=null,b=x=null,y=null};return{setScene(n,i){te();let a=i.track;if(E=0,!a){w=0,e.rt.remove(Pu);return}let o=lu(a,i.sampler);S=ee(o.mesh,`track mesh`),C=ee(dl(o.strips),`track glow`),E=a.gates.length,D=!1,T=new Float32Array(Math.max(1,E)*8),a.gates.forEach((e,t)=>T.set(Za(e.index),t*8)),w=o.flags.length;let s=new Float32Array(Math.max(1,w)*12);o.flags.forEach((e,t)=>s.set([e.pos[0],e.pos[1],e.pos[2],e.width,e.colour[0],e.colour[1],e.colour[2],e.height,e.seed,0,0,0],t*12)),b=t.createBuffer({label:`track gates`,size:T.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}),x=t.createBuffer({label:`track flags`,size:s.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}),t.queue.writeBuffer(x,0,s),y=t.createBindGroup({label:`track group 2`,layout:r,entries:[{binding:0,resource:{buffer:m}},{binding:1,resource:{buffer:b}},{binding:2,resource:{buffer:x}}]}),e.rt.setStatic(Pu,Au(a,i.sampler))},update(e,n){if(!y||!b)return;let r=n.time;h[0]=r,h[1]=Number.isFinite(j)?j:r,h[2]=n.dt,h[4]=M[0],h[5]=M[1],h[6]=M[2],j=r,t.queue.writeBuffer(m,0,h);let i=!D;for(let e=0;e<E;e++){let t=A.get(e);t!==void 0&&Number.isNaN(t)&&(t=r,A.set(e,r));let n=t===void 0?0:Math.min(1,Math.max(0,1-(r-t)/Nu)),a=e*8,o=T[a+4],s=T[a+5];T[a+4]=k.has(e)?2:+(e===O),T[a+5]=n,(o!==T[a+4]||s!==T[a+5])&&(i=!0)}i&&(t.queue.writeBuffer(b,0,T),D=!0)},ready:p,encodeGBuffer(e){y&&s&&c&&(e.setBindGroup(2,y),S&&(e.setPipeline(s),e.setVertexBuffer(0,S.vertex),e.setIndexBuffer(S.index,`uint32`),e.drawIndexed(S.indexCount)),w>0&&(e.setPipeline(c),e.setVertexBuffer(0,_),e.setIndexBuffer(v,`uint16`),e.drawIndexed(g.indices.length,w)))},encodeForward(e){y&&C&&l&&(e.setPipeline(l),e.setBindGroup(2,y),e.setVertexBuffer(0,C.vertex),e.setIndexBuffer(C.index,`uint32`),e.drawIndexed(C.indexCount))},setActiveGate(e){O=e;for(let t of k)t>=e&&k.delete(t);for(let t of A.keys())t>=e&&A.delete(t)},setGatePassed(e){k.has(e)||(k.add(e),A.set(e,NaN),O===e&&(O=-1))},setWind(e,t){let n=Math.hypot(e[0],e[1]);M=n>1e-6?[e[0]/n,e[1]/n,Math.max(0,t)]:[M[0],M[1],Math.max(0,t)]},destroy(e){te(),e.rt.remove(Pu),m.destroy(),_.destroy(),v.destroy()}}}function Lu(){let e=null,t=null,n=null,r=!1,i=-1,a=[],o=null,s=[];return{name:`objects`,sharedOverlayPass:!0,init(r){n=r,e=Iu(r),t=ul(r),i>=0&&e.setActiveGate(i);for(let t of a)e.setGatePassed(t);o&&e.setWind(o.dir,o.speed)},ready(){return e?.ready??Promise.resolve()},setScene(t,n){e?.setScene(t,n)},update(n,i){e?.update(n,i),t?.update(n,i,r),t?.updateRivals(i,s)},encodeGBuffer(n){e?.encodeGBuffer(n),t?.encodeGBuffer(n)},encodeForward(n){e?.encodeForward(n),t?.encodeForward(n)},setActiveGate(t){i=t;for(let e=a.length-1;e>=0;e--)a[e]>=t&&a.splice(e,1);e?.setActiveGate(t)},setGatePassed(t){a.includes(t)||a.push(t),i===t&&(i=-1),e?.setGatePassed(t)},setHideQuad(e){r=e},setWind(t,n){o={dir:t,speed:n},e?.setWind(t,n)},setRivals(e){s=e},destroy(){n&&(e?.destroy(n),t?.destroy(n)),e=null,t=null,n=null}}}var Ru=2048,zu=new WeakMap;function Bu(e,t){zu.set(e,t)}function Vu(e){return zu.get(e)}function Hu(e,t,n=Ru){let r=e.resolution,i=e.cellSize,[a,o]=e.origin,s=r/n*i,c=(e,t)=>((e-t)/i+.5)/r*n-.5,l=new Float32Array(n*n),u=new Float32Array(n*n).fill(1/0),d=new Float32Array(n*n).fill(-1/0),f=new Float32Array(n*n);for(let e of t){let t=e.x+e.cx,r=e.z+e.cz,i=e.y+e.cy,p=c(t,a),m=c(r,o),h=e.rx/s,g=e.rz/s,_=Math.max(0,Math.floor(p-h)),v=Math.min(n-1,Math.ceil(p+h)),y=Math.max(0,Math.floor(m-g)),b=Math.min(n-1,Math.ceil(m+g));for(let t=y;t<=b;t++)for(let r=_;r<=v;r++){let a=(r-p)/h,o=(t-m)/g,s=1-a*a-o*o;if(s<=0)continue;let c=2*e.ry*(e.cone?1-Math.sqrt(1-s):Math.sqrt(s)),_=e.cone?i-e.ry:i-c/2,v=t*n+r;l[v]+=e.density*c,u[v]=Math.min(u[v],_),d[v]=Math.max(d[v],_+c),f[v]=Math.max(f[v],e.rx,e.rz)}}let p=new Uint16Array(n*n*4);for(let e=0;e<n*n;e++){let t=e*4;l[e]>0&&(p[t]=Hi(l[e]),p[t+1]=Hi(u[e]),p[t+2]=Hi(d[e]),p[t+3]=Hi(f[e]))}return p}var Uu=[`shadow`,`gi`,`spec`],Wu={shadow:`16.0`,gi:`12.0`,spec:`8.0`},Gu={shadow:`SHADOW`,gi:`GI`,spec:`SPEC`};async function Ku(e,t){let n=e.device,r=t=>n.createPipelineLayout({bindGroupLayouts:[e.frame.layout,e.world.layout,t]}),i=t=>n.createPipelineLayout({bindGroupLayouts:[e.frame.layout,t]}),a=(t,r,i,a)=>n.createComputePipelineAsync({label:`rt ${t}`,layout:a,compute:{module:e.module(`rt/${r}.wgsl`,i),entryPoint:`main`}}),o=r(t.trace),s=Uu.map(e=>e===`shadow`?a(e,e,{GRP:2,CANOPY_SHADOW_MAP:!0},r(t.shadowTrace)):a(e,e,{GRP:2},o)),c=Uu.map(e=>a(`${e} temporal`,`temporal`,{GRP:1,[Gu[e]]:!0,CAP:Wu[e]},i(t.temporal))),l=Uu.map(e=>Array.from({length:3},(n,r)=>{let o=r===2,s=e===`shadow`&&o,c={GRP:1,[Gu[e]]:!0,ITER:`${r}.0`,OUTFMT:s?`r32float`:`rgba16float`,FINAL:o};return r===0&&(c.VARSTORE=!0),a(`${e} atrous ${r}`,`atrous`,c,i(s?t.atrousR32:t.atrousRgba))})),[u,d,f,p,m,h,g,_,...v]=await Promise.all([a(`aux`,`aux_pass`,{GRP:2},r(t.aux)),a(`latch`,`latch`,{GRP:1},i(t.latch)),a(`probe update`,`probe_update`,{GRP:2},r(t.probe)),a(`probe plan`,`probe_plan`,{GRP:1},i(t.probePlan)),a(`probe compact update`,`probe_update`,{GRP:2,COMPACT:!0},r(t.probeCompact)),t.giHits?a(`gi hits`,`gi`,{GRP:2,TRACE_ONLY:!0},r(t.giHits)):Promise.resolve(null),t.giShade?a(`gi shade`,`gi`,{GRP:2,SHADE_ONLY:!0,GI_RECORDED:!0,SHADE_VISIBILITY:!!t.giVisibility},r(t.giShade)):Promise.resolve(null),t.giVisibility?a(`gi visibility`,`gi`,{GRP:2,GI_RECORDED:!0,VISIBILITY_ONLY:!0},r(t.giVisibility)):Promise.resolve(null),...s,...c,...l.flat()]),y=e=>v.slice(e,e+3);return{aux:u,latch:d,probe:f,probePlan:p,probeCompact:m,giHits:h,giShade:g,giVisibility:_,trace:{shadow:v[0],gi:v[1],spec:v[2]},temporal:{shadow:v[3],gi:v[4],spec:v[5]},atrous:{shadow:y(6),gi:y(9),spec:y(12)}}}function qu(e,t){let n=e.device.createPipelineLayout({bindGroupLayouts:[e.frame.layout,e.world.layout,t.test]});return e.device.createComputePipelineAsync({label:`rt selftest`,layout:n,compute:{module:e.module(`rt/test.wgsl`,{GRP:2}),entryPoint:`main`}})}var R=(e,t)=>({binding:e,resource:{buffer:t}}),z=(e,t)=>({binding:e,resource:t});function Ju(e){return[e(0),e(1)]}function Yu(e){let{rc:t,layouts:n,tex:r,probes:i,buffers:a}=e,o=t.device,s=t.gbuf.views,c={shadow:s.sunShadow,gi:s.giDiffuse,spec:s.giSpecular},l={shadow:r.shadow,gi:r.gi,spec:r.spec},u=Ju(t=>o.createBindGroup({label:`rt aux ${t}`,layout:n.aux,entries:[R(0,e.params),z(1,s.depth),z(2,s.normal),z(3,s.misc),z(4,r.auxDepth[t].view),z(5,r.auxNormal[t].view)]})),d=Ju(r=>{let s=i.sets[r],c=i.sets[r^1];return o.createBindGroup({label:`rt probes ${r}`,layout:n.probe,entries:[R(0,e.params),R(1,a.nodes),R(2,a.prims),z(3,s.r.view),z(4,s.g.view),z(5,s.b.view),z(6,c.r.view),z(7,c.g.view),z(8,c.b.view),R(9,e.prevPre),{binding:10,resource:e.probeSampler},z(11,e.cloud),R(16,t.parkLights.buffer)]})}),f=o.createBindGroup({label:`rt latch`,layout:n.latch,entries:[R(0,e.params),R(1,e.prevPre)]}),p=i.work?Ju(t=>{let r=i.sets[t],a=i.sets[t^1];return o.createBindGroup({label:`rt probe plan ${t}`,layout:n.probePlan,entries:[R(0,e.params),z(3,r.r.view),z(4,r.g.view),z(5,r.b.view),z(6,a.r.view),z(7,a.g.view),z(8,a.b.view),R(9,e.prevPre),R(12,i.work.ids),R(13,i.work.args)]})}):null,m=i.work?Ju(r=>{let s=i.sets[r],c=i.sets[r^1];return o.createBindGroup({label:`rt probes compact ${r}`,layout:n.probeCompact,entries:[R(0,e.params),R(1,a.nodes),R(2,a.prims),z(3,s.r.view),z(4,s.g.view),z(5,s.b.view),z(6,c.r.view),z(7,c.g.view),z(8,c.b.view),R(9,e.prevPre),{binding:10,resource:e.probeSampler},z(11,e.cloud),R(12,i.work.ids),R(16,t.parkLights.buffer)]})}):null,h=(s,c)=>{let l=i.sets[s^1],u=r.giHits;return o.createBindGroup({label:`rt gi `+(c?`shade`:`hits`)+` `+s,layout:c?n.giShade:n.giHits,entries:[R(0,e.params),R(1,a.nodes),R(2,a.prims),z(3,l.r.view),z(4,l.g.view),z(5,l.b.view),z(6,r.auxDepth[s].view),z(7,r.auxNormal[s].view),z(8,c?r.raw0.view:u[0].view),z(9,c?r.raw1.view:u[1].view),{binding:10,resource:e.probeSampler},z(11,e.cloud),R(16,t.parkLights.buffer),...c?[z(12,u[0].view),z(13,u[1].view),...r.giVisibility?[z(14,r.giVisibility[0].view),z(15,r.giVisibility[1].view)]:[]]:[]]})},g={aux:u,probe:d,probePlan:p,probeCompact:m,latch:f,giHits:r.giHits?Ju(e=>h(e,!1)):null,giShade:r.giHits?Ju(e=>h(e,!0)):null,giVisibility:r.giVisibility?Ju(s=>{let c=i.sets[s^1],l=r.giHits,u=r.giVisibility;return o.createBindGroup({label:`rt gi visibility `+s,layout:n.giVisibility,entries:[R(0,e.params),R(1,a.nodes),R(2,a.prims),z(3,c.r.view),z(4,c.g.view),z(5,c.b.view),z(6,r.auxDepth[s].view),z(7,r.auxNormal[s].view),z(8,u[0].view),z(9,u[1].view),{binding:10,resource:e.probeSampler},z(11,e.cloud),z(12,l[0].view),z(13,l[1].view),R(16,t.parkLights.buffer)]})}):null,trace:{},temporal:{},atrous:{}};for(let u of Uu){let d=l[u];if(!d)continue;let f=r.raw1.view;g.trace[u]=Ju(s=>{let c=i.sets[s^1];return o.createBindGroup({label:`rt ${u} trace ${s}`,layout:u===`shadow`?n.shadowTrace:n.trace,entries:[R(0,e.params),R(1,a.nodes),R(2,a.prims),z(3,c.r.view),z(4,c.g.view),z(5,c.b.view),z(6,r.auxDepth[s].view),z(7,r.auxNormal[s].view),z(8,r.raw0.view),z(9,f),{binding:10,resource:e.probeSampler},z(11,e.cloud),R(16,t.parkLights.buffer),...u===`shadow`?[z(17,e.canopy)]:[]]})}),g.temporal[u]=Ju(t=>o.createBindGroup({label:`rt ${u} temporal ${t}`,layout:n.temporal,entries:[R(0,e.params),z(1,r.auxDepth[t].view),z(2,r.auxNormal[t].view),z(3,r.auxDepth[t^1].view),z(4,r.auxNormal[t^1].view),z(5,s.motion),z(6,r.raw0.view),z(7,f),z(8,d.hist[t^1].view),z(9,d.mom[t^1].view),R(10,e.prevPre),z(11,d.hist[t].view),z(12,d.mom[t].view)]}));let p=u===`shadow`?n.atrousR32:n.atrousRgba;g.atrous[u]=Ju(t=>Array.from({length:3},(i,a)=>{let s=a===0?d.hist[t].view:a===1?r.tmpA.view:r.tmpB.view,l=a===0?r.tmpA.view:a===1?r.tmpB.view:c[u];return o.createBindGroup({label:`rt ${u} atrous ${a} ${t}`,layout:a===2?p:n.atrousRgba,entries:[R(0,e.params),z(1,r.auxDepth[t].view),z(2,r.auxNormal[t].view),z(3,s),z(4,d.mom[t].view),z(5,l),R(6,r.varSum)]})}))}return g}function Xu(e){let t=GPUShaderStage.COMPUTE,n=e=>({binding:e,visibility:t,buffer:{type:`uniform`}}),r=e=>({binding:e,visibility:t,buffer:{type:`read-only-storage`}}),i=e=>({binding:e,visibility:t,buffer:{type:`storage`}}),a=e=>({binding:e,visibility:t,texture:{sampleType:`unfilterable-float`}}),o=e=>({binding:e,visibility:t,texture:{sampleType:`float`,viewDimension:`3d`}}),s=(e,n)=>({binding:e,visibility:t,storageTexture:{access:`write-only`,format:n}}),c=e=>({binding:e,visibility:t,storageTexture:{access:`write-only`,format:`rgba16float`,viewDimension:`3d`}}),l=(t,n)=>e.createBindGroupLayout({label:`rt ${t}`,entries:n}),u=(e,t)=>Array.from({length:t-e+1},(t,n)=>a(e+n)),d={binding:10,visibility:t,sampler:{type:`filtering`}},f={binding:11,visibility:t,texture:{sampleType:`float`}},p=e.limits.maxSampledTexturesPerShaderStage>=17,m=e.limits.maxSampledTexturesPerShaderStage>=19,h=e=>[n(0),r(1),r(2),o(3),o(4),o(5),a(6),a(7),s(8,e),s(9,e),d,f,r(16)],g=[n(0),r(1),r(2),o(3),o(4),o(5),c(6),c(7),c(8),r(9),d,f,r(16)];return{trace:l(`trace`,h(`rgba16float`)),shadowTrace:l(`shadow trace`,[...h(`rgba16float`),{binding:17,visibility:t,texture:{sampleType:`float`}}]),giHits:p?l(`gi hits`,h(`rg32float`)):null,giVisibility:m?l(`gi visibility`,[...h(`r32float`),a(12),a(13)]):null,giShade:p?l(`gi shade`,[...h(`rgba16float`),a(12),a(13),...m?[a(14),a(15)]:[]]):null,probe:l(`probe`,g),probeCompact:l(`probe compact`,[...g,r(12)]),probePlan:l(`probe plan`,[n(0),o(3),o(4),o(5),c(6),c(7),c(8),r(9),i(12),i(13)]),test:l(`test`,[n(0),r(1),r(2),r(3),i(4)]),aux:l(`aux`,[n(0),{binding:1,visibility:t,texture:{sampleType:`depth`}},a(2),a(3),s(4,`r32float`),s(5,`rgba16float`)]),temporal:l(`temporal`,[n(0),...u(1,9),r(10),s(11,`rgba16float`),s(12,`rgba16float`)]),atrousRgba:l(`atrous rgba`,[n(0),...u(1,4),s(5,`rgba16float`),i(6)]),atrousR32:l(`atrous r32`,[n(0),...u(1,4),s(5,`r32float`),i(6)]),latch:l(`latch`,[n(0),i(1)])}}var Zu=class{buffer=new ArrayBuffer(144);u32=new Uint32Array(this.buffer);i32=new Int32Array(this.buffer);f32=new Float32Array(this.buffer);write(e){let t=this.u32,n=this.i32,r=this.f32;t[0]=e.rtWidth,t[1]=e.rtHeight,t[2]=e.fullWidth,t[3]=e.fullHeight,t[4]=e.divisor,t[5]=e.maxSteps,t[6]=e.giRays,t[7]=+!!e.spec|(e.terrain?2:0),t[8]=e.staticRoot,t[9]=e.dynamicRoot,t[10]=e.visitCap,t[11]=e.frameIndex,t[12]=e.debugView,t[13]=e.seed,t[14]=e.probeStride,t[15]=e.probePhase,n[16]=e.probeLo[0],n[17]=e.probeLo[1],n[18]=e.probeLo[2],n[19]=e.probeRays,n[20]=e.probePrevLo[0],n[21]=e.probePrevLo[1],n[22]=e.probePrevLo[2],n[23]=+!!e.probeAllFresh,t[24]=e.probeDim[0],t[25]=e.probeDim[1],t[26]=e.probeDim[2],t[27]=0,r[28]=e.softness,r[29]=e.probeSpacing,r[30]=e.probeHysteresis,r[31]=e.rayRange,r[32]=e.cloudCenterX,r[33]=e.cloudCenterZ,r[34]=e.cloudExtentM,r[35]=e.cloudSkyGain}},Qu=15e4,$u=192,ed=2e4,td=32;function nd(e){let t=Math.max(e.giRays,1)*e.rtMaxSteps/$u;return{rayBudget:Math.max(ed,Math.round(Qu*t/1e3)*1e3),maxStride:Math.min(td,Math.max(16,Math.ceil(16/t)))}}function rd(e,t,n=Qu,r=16){return Math.min(r,Math.max(1,Math.ceil(e*t/Math.max(n,1))))}function id(e,t){return Number.isSafeInteger(e)&&e>0&&e<=2147483647&&e<=t.maxComputeWorkgroupsPerDimension&&Math.max(e*4,16)<=Math.min(t.maxStorageBufferBindingSize,t.maxBufferSize)}var ad=class{limits;sets;dim;spacing;raysPerProbe;total;stride;work;lo=[0,0,0];prevLo=[0,0,0];allFresh=!0;valid=!1;textures=[];constructor(e,t,n={rayBudget:Qu,maxStride:16}){this.limits=n,this.dim=[t.dim[0],t.dim[1],t.dim[2]],this.spacing=t.spacing,this.raysPerProbe=t.raysPerProbe,this.total=t.dim[0]*t.dim[1]*t.dim[2],this.stride=rd(this.total,t.raysPerProbe,n.rayBudget,n.maxStride);let r=t=>({r:this.make(e,`rt probe R ${t}`),g:this.make(e,`rt probe G ${t}`),b:this.make(e,`rt probe B ${t}`)});if(this.sets=[r(0),r(1)],this.work=null,this.stride>1&&id(this.total,e.limits)){let t=e.createBuffer({label:`rt active probe ids`,size:this.total*4,usage:GPUBufferUsage.STORAGE}),n=e.createBuffer({label:`rt active probe dispatch`,size:16,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.INDIRECT|GPUBufferUsage.COPY_DST,mappedAtCreation:!0});new Uint32Array(n.getMappedRange()).set([0,1,1,0]),n.unmap(),this.work={ids:t,args:n}}}make(e,t){let n=GPUTextureUsage,r=e.createTexture({label:t,dimension:`3d`,format:`rgba16float`,size:[this.dim[0],this.dim[1],this.dim[2]],usage:n.STORAGE_BINDING|n.TEXTURE_BINDING|n.COPY_SRC});return this.textures.push(r),{texture:r,view:r.createView({dimension:`3d`})}}matches(e,t){return t.rayBudget===this.limits.rayBudget&&t.maxStride===this.limits.maxStride&&e.dim[0]===this.dim[0]&&e.dim[1]===this.dim[1]&&e.dim[2]===this.dim[2]&&e.spacing===this.spacing&&e.raysPerProbe===this.raysPerProbe}get bytes(){return this.total*8*6+(this.work?this.total*4+16:0)}get useCompact(){return this.work!==null&&!this.allFresh&&this.stride>1}get raysPerFrame(){return Math.ceil(this.total/this.stride)*this.raysPerProbe}reset(){this.valid=!1}plan(e,t,n){let r=this.spacing,i=this.dim;this.prevLo=this.lo,this.lo=[Math.round(e/r)-(i[0]>>1),Math.floor(n/r)-1,Math.round(t/r)-(i[2]>>1)],this.allFresh=!this.valid}commit(){this.valid=!0}destroy(){this.work?.ids.destroy(),this.work?.args.destroy();for(let e of this.textures)e.destroy();this.textures.length=0}};function od(e){if(e.type!==`sphere`)return!1;let[t,n,r]=e.material.albedo;return e.material.metalness===0&&e.material.roughness>=.9&&n>t&&n>r&&n<.3&&!e.material.emissive}var sd={Obb:0,Capsule:1,Sphere:2,Torus:3,Cylinder:4,Ellipsoid:5,Cone:6,Gable:7},cd=e=>e<0?0:e>1?1:e,ld=e=>Math.round(cd(e)*255);function ud(e,t,n){let r=n.albedo[0],i=n.albedo[1],a=n.albedo[2],o=n.emissive,s=o?.[0]??0,c=o?.[1]??0,l=o?.[2]??0,u=(ld(r)|ld(i)<<8|ld(a)<<16|ld(n.roughness)<<24)>>>0,d=o?(Hi(s)|Hi(c)<<16)>>>0:0,f=((o?Hi(l):0)|(n.metalness>0?Hi(cd(n.metalness)):0)<<16)>>>0;e[t+12]=u,e[t+13]=d,e[t+14]=f}function dd(e,t,n){let r=1/(Math.sqrt(n[0]**2+n[1]**2+n[2]**2+n[3]**2)||1);e[t]=n[0]*r,e[t+1]=n[1]*r,e[t+2]=n[2]*r,e[t+3]=n[3]*r}function fd(e,t,n){e[t]=n[0],e[t+1]=n[1],e[t+2]=n[2]}function pd(e,t,n,r){switch(e[n+8]=0,e[n+9]=0,e[n+10]=0,e[n+11]=1,e[n+4]=0,e[n+5]=0,e[n+6]=0,e[n+7]=0,r.type){case`obb`:fd(e,n,r.center),t[n+3]=sd.Obb,fd(e,n+4,r.half),dd(e,n+8,r.rot);break;case`cylinder`:case`ellipsoid`:case`cone`:case`gable`:fd(e,n,r.center),t[n+3]=r.type===`cylinder`?sd.Cylinder:r.type===`cone`?sd.Cone:r.type===`gable`?sd.Gable:sd.Ellipsoid,fd(e,n+4,r.half),dd(e,n+8,r.rot);break;case`capsule`:fd(e,n,r.a),t[n+3]=sd.Capsule,fd(e,n+4,r.b),e[n+7]=r.radius;break;case`sphere`:fd(e,n,r.center),t[n+3]=sd.Sphere,e[n+7]=r.radius;break;case`torus`:fd(e,n,r.center),t[n+3]=sd.Torus,e[n+4]=r.major,e[n+7]=r.minor,dd(e,n+8,r.rot)}ud(t,n,r.material),t[n+15]=+!!od(r)}function md(e,t){let[n,r,i,a]=e,o=2/(n*n+r*r+i*i+a*a||1);t[0]=1-o*(r*r+i*i),t[1]=o*(n*r-i*a),t[2]=o*(n*i+r*a),t[3]=o*(n*r+i*a),t[4]=1-o*(n*n+i*i),t[5]=o*(r*i-n*a),t[6]=o*(n*i-r*a),t[7]=o*(r*i+n*a),t[8]=1-o*(n*n+r*r)}var hd=new Float64Array(9);function gd(e,t){let n,r,i,a,o,s;switch(e.type){case`sphere`:[n,r,i]=e.center,a=o=s=e.radius;break;case`capsule`:n=.5*(e.a[0]+e.b[0]),r=.5*(e.a[1]+e.b[1]),i=.5*(e.a[2]+e.b[2]),a=.5*Math.abs(e.a[0]-e.b[0])+e.radius,o=.5*Math.abs(e.a[1]-e.b[1])+e.radius,s=.5*Math.abs(e.a[2]-e.b[2])+e.radius;break;case`obb`:case`cylinder`:case`ellipsoid`:case`cone`:case`gable`:case`torus`:{md(e.rot,hd);let t=e.type===`torus`?[e.major+e.minor,e.minor,e.major+e.minor]:e.half;[n,r,i]=e.center,a=Math.abs(hd[0])*t[0]+Math.abs(hd[1])*t[1]+Math.abs(hd[2])*t[2],o=Math.abs(hd[3])*t[0]+Math.abs(hd[4])*t[1]+Math.abs(hd[5])*t[2],s=Math.abs(hd[6])*t[0]+Math.abs(hd[7])*t[1]+Math.abs(hd[8])*t[2];break}}t[0]=n-a,t[1]=r-o,t[2]=i-s,t[3]=n+a,t[4]=r+o,t[5]=i+s}var _d=4294967295,vd=1<<17,yd=2,bd=14;function xd(e){return e=e*65537&4278190335,e=e*257&251719695,e=e*17&3272356035,e=e*5&1227133513,e>>>0}function Sd(e,t,n){return(xd(e)<<2|xd(t)<<1|xd(n))>>>0}var Cd=class{capacity=0;bounds=new Float32Array;codes=new Uint32Array;order=new Uint32Array;tmpBounds=new Float32Array(6);target;prims=[];nodeBase=0;primBase=0;nextNode=0;get sortedOrder(){return this.order}reserve(e){e<=this.capacity||(this.capacity=Math.max(e,this.capacity*2,64),this.bounds=new Float32Array(this.capacity*6),this.codes=new Uint32Array(this.capacity),this.order=new Uint32Array(this.capacity))}build(e,t,n,r){if(e.length>131072)throw Error(`RT scene exceeds ${vd} primitives`);let i=e.length;if(i===0)return{root:_d,nodeCount:0,primCount:0};this.reserve(i),this.target=t,this.prims=e,this.nodeBase=n,this.primBase=r;let a=this.bounds,o=this.tmpBounds,s=1/0,c=1/0,l=1/0,u=-1/0,d=-1/0,f=-1/0;for(let t=0;t<i;t++){gd(e[t],o);for(let e=0;e<6;e++)a[t*6+e]=o[e];let n=.5*(o[0]+o[3]),r=.5*(o[1]+o[4]),i=.5*(o[2]+o[5]);s=Math.min(s,n),u=Math.max(u,n),c=Math.min(c,r),d=Math.max(d,r),l=Math.min(l,i),f=Math.max(f,i)}let p=1023/Math.max(u-s,1e-6),m=1023/Math.max(d-c,1e-6),h=1023/Math.max(f-l,1e-6);for(let e=0;e<i;e++){let t=.5*(a[e*6]+a[e*6+3]),n=.5*(a[e*6+1]+a[e*6+4]),r=.5*(a[e*6+2]+a[e*6+5]);this.codes[e]=Sd(Math.round((t-s)*p),Math.round((n-c)*m),Math.round((r-l)*h)),this.order[e]=e}this.sortOrder(i);for(let n=0;n<i;n++)pd(t.primsF,t.primsU,(r+n)*16,e[this.order[n]]);return this.nextNode=n+1,this.split(0,i,n,0),{root:n,nodeCount:this.nextNode-n,primCount:i}}sortOrder(e){let t=this.codes,n=this.order;if(e<=96){for(let r=1;r<e;r++){let e=n[r],i=t[e],a=r-1;for(;a>=0&&t[n[a]]>i;)n[a+1]=n[a],a--;n[a+1]=e}return}n.subarray(0,e).sort((e,n)=>t[e]-t[n]||e-n)}refit(e){let t=e.length,{nodesF:n,nodesU:r}=this.target,i=this.tmpBounds;for(let n=0;n<t;n++)pd(this.target.primsF,this.target.primsU,(this.primBase+n)*16,e[this.order[n]]);for(let t=this.nextNode-1;t>=this.nodeBase;t--){let a=t*8,o=r[a+7],s=r[a+3];if(o){gd(e[this.order[s-this.primBase]],i);let t=i[0],r=i[1],c=i[2],l=i[3],u=i[4],d=i[5];for(let n=1;n<o;n++)gd(e[this.order[s-this.primBase+n]],i),t=Math.min(t,i[0]),r=Math.min(r,i[1]),c=Math.min(c,i[2]),l=Math.max(l,i[3]),u=Math.max(u,i[4]),d=Math.max(d,i[5]);n[a]=t,n[a+1]=r,n[a+2]=c,n[a+4]=l,n[a+5]=u,n[a+6]=d}else{let e=s*8,t=e+8;n[a]=Math.min(n[e],n[t]),n[a+1]=Math.min(n[e+1],n[t+1]),n[a+2]=Math.min(n[e+2],n[t+2]),n[a+4]=Math.max(n[e+4],n[t+4]),n[a+5]=Math.max(n[e+5],n[t+5]),n[a+6]=Math.max(n[e+6],n[t+6])}}return{root:t?this.nodeBase:_d,primCount:t,nodeCount:t?this.nextNode-this.nodeBase:0}}split(e,t,n,r){let{nodesF:i,nodesU:a}=this.target,o=this.bounds,s=this.order,c=1/0,l=1/0,u=1/0,d=-1/0,f=-1/0,p=-1/0;for(let n=e;n<t;n++){let e=s[n]*6;c=Math.min(c,o[e]),l=Math.min(l,o[e+1]),u=Math.min(u,o[e+2]),d=Math.max(d,o[e+3]),f=Math.max(f,o[e+4]),p=Math.max(p,o[e+5])}let m=n*8;if(i[m]=c,i[m+1]=l,i[m+2]=u,i[m+4]=d,i[m+5]=f,i[m+6]=p,t-e<=yd){a[m+3]=this.primBase+e,a[m+7]=t-e;return}let h=e+t>>1,g=this.codes[s[e]],_=this.codes[s[t-1]];if(g!==_&&r<bd){let n=31-Math.clz32(g^_),r=e,i=t-1;for(;i-r>1;){let e=r+i>>1;this.codes[s[e]]>>>n&1?i=e:r=e}h=i}let v=this.nextNode;this.nextNode+=2,a[m+3]=v,a[m+7]=0,this.split(e,h,v,r+1),this.split(h,t,v+1,r+1)}},wd=1e-4,Td=new Float64Array(9);function Ed(e,t,n,r,i=512){switch(e.type){case`sphere`:return Dd(e.center,e.radius,t,n,r);case`capsule`:return Od(e.a,e.b,e.radius,t,n,r);case`obb`:return Pd(e.center,e.half,e.rot,t,n,r);case`cylinder`:case`ellipsoid`:return Nd(e,t,n,r);case`cone`:return Md(e,t,n,r);case`gable`:return jd(e,t,n,r);case`torus`:return Id(e,t,n,r,i)}}function Dd(e,t,n,r,i){let a=n[0]-e[0],o=n[1]-e[1],s=n[2]-e[2],c=a*r[0]+o*r[1]+s*r[2],l=c*c-(a*a+o*o+s*s-t*t);if(l<0)return 1/0;let u=-c-Math.sqrt(l);return u>1e-4&&u<=i?u:1/0}function Od(e,t,n,r,i,a){let o=t[0]-e[0],s=t[1]-e[1],c=t[2]-e[2],l=r[0]-e[0],u=r[1]-e[1],d=r[2]-e[2],f=o*o+s*s+c*c;if(f<1e-12)return Dd(e,n,r,i,a);let p=Math.sqrt(f),m=o/p,h=s/p,g=c/p,_=l*m+u*h+d*g,v=i[0]*m+i[1]*h+i[2]*g,y=Math.max(0,Math.min(p,_)),b=l-m*y,x=u-h*y,S=d-g*y;if(b*b+x*x+S*S<n*n)return 1/0;let C=l-m*_,w=u-h*_,T=d-g*_,E=i[0]-m*v,D=i[1]-h*v,O=i[2]-g*v,k=E*E+D*D+O*O;if(k>0){let o=-(C*E+w*D+T*O)/k,s=C+o*E,c=w+o*D,l=T+o*O,u=n*n-(s*s+c*c+l*l);if(u<0)return 1/0;let d=o-Math.sqrt(u/k),f=_+d*v;return f>=0&&f<=p?d>1e-4&&d<=a?d:1/0:Dd(f<0?e:t,n,r,i,a)}return Math.min(Dd(e,n,r,i,a),Dd(t,n,r,i,a))}function kd(e,t,n,r){let i=r?t[0]:t[0]-e[0],a=r?t[1]:t[1]-e[1],o=r?t[2]:t[2]-e[2];n[0]=Td[0]*i+Td[3]*a+Td[6]*o,n[1]=Td[1]*i+Td[4]*a+Td[7]*o,n[2]=Td[2]*i+Td[5]*a+Td[8]*o}var B=[0,0,0],V=[0,0,0],Ad=[[0,-1,0],[2,1,0],[-2,1,0],[0,0,1],[0,0,-1]];function jd(e,t,n,r){md(e.rot,Td),kd(e.center,t,B,!1),kd(e.center,n,V,!0);let i=-1/0,a=1/0;for(let t of Ad){let n=1,r=0;for(let i=0;i<3;i++)n-=t[i]*B[i]/e.half[i],r+=t[i]*V[i]/e.half[i];if(Math.abs(r)<1e-12){if(n<0)return 1/0;continue}let o=n/r;r<0?i=Math.max(i,o):a=Math.min(a,o)}return i<=a&&i>1e-4&&i<=r?i:1/0}function Md(e,t,n,r){md(e.rot,Td),kd(e.center,t,B,!1),kd(e.center,n,V,!0);let i=e.half,a=B[0]/i[0],o=B[2]/i[2],s=(i[1]-B[1])/(2*i[1]),c=V[0]/i[0],l=V[2]/i[2],u=-V[1]/(2*i[1]);if(s>0&&s<1&&a*a+o*o<s*s)return 1/0;let d=c*c+l*l-u*u,f=a*c+o*l-s*u,p=a*a+o*o-s*s,m=1/0,h=e=>{let t=s+e*u;e>1e-4&&e<=r&&e<m&&t>=0&&t<=1&&(m=e)};if(Math.abs(d)<1e-12)Math.abs(f)>1e-12&&h(-p/(2*f));else{let e=f*f-d*p;if(e>=0){let t=-f-(f<0?-1:1)*Math.sqrt(e);h(t/d),Math.abs(t)>1e-20&&h(p/t)}}if(Math.abs(u)>1e-12){let e=(1-s)/u;(a+e*c)**2+(o+e*l)**2<=1&&h(e)}return m}function Nd(e,t,n,r){md(e.rot,Td),kd(e.center,t,B,!1),kd(e.center,n,V,!0);let i=e.half,a=e.type===`cylinder`?[0,2]:[0,1,2],o=0,s=0,c=-1;for(let e of a)o+=(V[e]/i[e])**2,s+=B[e]*V[e]/i[e]**2,c+=(B[e]/i[e])**2;if(c<0&&(e.type===`ellipsoid`||Math.abs(B[1])<i[1]))return 1/0;let l=1/0,u=s*s-o*c;if(o>1e-14&&u>=0){let t=(-s-Math.sqrt(u))/o;t>1e-4&&t<=r&&(e.type===`ellipsoid`||Math.abs(B[1]+t*V[1])<=i[1])&&(l=t)}if(e.type===`cylinder`&&Math.abs(V[1])>1e-12)for(let e of[-1,1]){let t=(e*i[1]-B[1])/V[1];t>1e-4&&t<=r&&t<l&&((B[0]+t*V[0])/i[0])**2+((B[2]+t*V[2])/i[2])**2<=1&&(l=t)}return l}function Pd(e,t,n,r,i,a){md(n,Td),kd(e,r,B,!1),kd(e,i,V,!0);let o=-1/0,s=1/0;for(let e=0;e<3;e++){if(Math.abs(V[e])<1e-12){if(Math.abs(B[e])>t[e])return 1/0;continue}let n=1/V[e],r=(-t[e]-B[e])*n,i=(t[e]-B[e])*n;o=Math.max(o,Math.min(r,i)),s=Math.min(s,Math.max(r,i))}return o<=s&&o>1e-4&&o<=a?o:1/0}function Fd(e,t,n,r,i){let a=Math.hypot(e,n)-r;return Math.hypot(a,t)-i}function Id(e,t,n,r,i){md(e.rot,Td),kd(e.center,t,B,!1),kd(e.center,n,V,!0);let a=e.major+e.minor,o=B[0]*V[0]+B[1]*V[1]+B[2]*V[2],s=o*o-(B[0]*B[0]+B[1]*B[1]+B[2]*B[2]-a*a);if(s<0)return 1/0;let c=Math.sqrt(s),l=Math.max(-o-c,wd),u=Math.min(-o+c,r);if(Fd(B[0]+V[0]*l,B[1]+V[1]*l,B[2]+V[2]*l,e.major,e.minor)<0)return 1/0;for(let t=0;t<i;t++){let t=Fd(B[0]+V[0]*l,B[1]+V[1]*l,B[2]+V[2]*l,e.major,e.minor);if(t<1e-4+1e-5*l)return l;if(l+=t,l>u)return 1/0}return 1/0}function Ld(e,t,n,r,i=512){let a={t:1/0,index:-1};for(let o=0;o<e.length;o++){let s=Ed(e[o],t,n,Math.min(r,a.t),i);s<a.t&&(a={t:s,index:o})}return a}var Rd=1e3,zd=1e3,Bd=.5,Vd=.05,Hd=4e3,Ud=512,Wd=8;function Gd(e){let t=e>>>0;return()=>{t=t+1831565813>>>0;let e=Math.imul(t^t>>>15,1|t);return e=e+Math.imul(e^e>>>7,61|e)^e,((e^e>>>14)>>>0)/4294967296}}function Kd(e){let t=2*e()-1,n=2*Math.PI*e(),r=Math.sqrt(1-t*t);return[r*Math.cos(n),t,r*Math.sin(n)]}function qd(e,t,n,r){let i=e.data,a=i.resolution*i.cellSize;for(let o=0;o<Rd;o++){let s=i.origin[0]+a*(.05+.9*t()),c=i.origin[1]+a*(.05+.9*t()),l=e.heightAt(s,c)+1+150*t()*t(),u=Kd(t);u[1]=-Math.abs(u[1])*(t()<.7?1:.15);let d=Math.hypot(u[0],u[1],u[2]);n.set([s,l,c,Hd,u[0]/d,u[1]/d,u[2]/d,0],(r+o)*8)}}function Jd(e,t,n,r){let i=[0,0,0,0,0,0];for(let a=0;a<zd;a++){let o=e[Math.floor(t()*e.length)];gd(o,i);let s=[0,1,2].map(e=>i[e]+(i[e+3]-i[e])*t()),c=Kd(t),l=4+60*t(),u=[0,1,2].map(e=>s[e]+c[e]*l),d=[0,1,2].map(e=>s[e]-u[e]);t()<.2&&(d=Kd(t));let f=Math.hypot(d[0],d[1],d[2]);n.set([u[0],u[1],u[2],400,d[0]/f,d[1]/f,d[2]/f,1],(r+a)*8)}}async function Yd(e,t,n,r,i,a){let o=Gd(24301),s=e.rt.allStatic(),c=e.rt.allDynamic(),l=[...s,...c],u=i?Rd:0,d=l.length?zd:0,f=u+d,p={heightfield:{n:u,maxErr:0,mismatches:0},bvh:{n:d,mismatches:0,torusBudgetMisses:0,failures:[]}};if(f===0)return p;r.sync(e.rt);let m=new Float32Array(f*8);i&&qd(i,o,m,0),d&&Jd(l,o,m,u);let h=e.device,g=GPUBufferUsage,_=new Zu;_.write({rtWidth:f,rtHeight:1,fullWidth:f,fullHeight:1,divisor:1,maxSteps:a,giRays:0,spec:!1,terrain:!0,staticRoot:r.staticRoot,dynamicRoot:r.dynamicRoot,visitCap:Ud,frameIndex:0,debugView:0,seed:0,probeStride:1,probePhase:0,probeLo:[0,0,0],probeRays:0,probePrevLo:[0,0,0],probeAllFresh:!0,probeDim:[1,1,1],softness:1,probeSpacing:1,probeHysteresis:0,rayRange:1,cloudCenterX:0,cloudCenterZ:0,cloudExtentM:1,cloudSkyGain:1});let v=h.createBuffer({label:`rt test params`,size:144,usage:g.UNIFORM|g.COPY_DST}),y=h.createBuffer({label:`rt test rays`,size:m.byteLength,usage:g.STORAGE|g.COPY_DST}),b=f*16,x=h.createBuffer({label:`rt test results`,size:b,usage:g.STORAGE|g.COPY_SRC}),S=h.createBuffer({label:`rt test readback`,size:b,usage:g.COPY_DST|g.MAP_READ});h.queue.writeBuffer(v,0,_.buffer),h.queue.writeBuffer(y,0,m);let C=h.createBindGroup({label:`rt test`,layout:t.test,entries:[{binding:0,resource:{buffer:v}},{binding:1,resource:{buffer:r.nodes}},{binding:2,resource:{buffer:r.prims}},{binding:3,resource:{buffer:y}},{binding:4,resource:{buffer:x}}]}),w=h.createCommandEncoder({label:`rt test`}),T=w.beginComputePass({label:`rt test`});T.setPipeline(n),T.setBindGroup(0,e.frame.group),T.setBindGroup(1,e.world.group),T.setBindGroup(2,C),T.dispatchWorkgroups(Math.ceil(f/64)),T.end(),w.copyBufferToBuffer(x,0,S,0,b),h.queue.submit([w.finish()]),await S.mapAsync(GPUMapMode.READ);let E=new Float32Array(S.getMappedRange().slice(0));S.unmap();for(let e of[v,y,x,S])e.destroy();for(let e=0;e<u;e++){let t=m.subarray(8*e,8*e+8),n=i.raycast([t[0],t[1],t[2]],[t[4],t[5],t[6]],Hd),r=E[4*e];if(n===null!=r<0){p.heightfield.mismatches++;continue}if(n===null)continue;let a=Math.abs(n.t-r);p.heightfield.maxErr=Math.max(p.heightfield.maxErr,a),a>=Bd&&p.heightfield.mismatches++}for(let e=u;e<f;e++){let t=m.subarray(8*e,8*e+8),n=[t[0],t[1],t[2]],i=[t[4],t[5],t[6]],a=E[4*e],o=e=>e.index>=0!=a>=0||e.index>=0&&Math.abs(e.t-a)>Vd,c=Ld(l,n,i,t[3],32);if(o(c)){if(p.bvh.mismatches++,p.bvh.failures.length<Wd){let o=E[4*e+1],d=o>=0?r.slotToPrim(o):null,f=d?d.index+(d.dynamic?s.length:0):-1;p.bvh.failures.push({ray:e-u,origin:n,direction:i,tMax:t[3],visitCap:Ud,cpu:{index:c.index,shape:l[c.index]?.type??null,distance:Number.isFinite(c.t)?c.t:null,primitive:l[c.index]?structuredClone(l[c.index]):null},gpu:{slot:o,index:f,shape:l[f]?.type??null,distance:a>=0?a:null,raw:Array.from(E.subarray(4*e,4*e+4)),primitive:l[f]?structuredClone(l[f]):null}})}}else o(Ld(l,n,i,t[3]))&&p.bvh.torusBudgetMisses++}return p}var Xd=64,Zd=class{device;nodes;prims;staticRoot=_d;dynamicRoot=_d;generation=0;staticRebuilds=0;target;staticCap=0;staticBuilder=new Cd;dynamicBuilder=new Cd;staticCount=0;dynamicCount=0;staticNodeCount=0;dynamicNodeCount=0;staticKey=-1;version=-1;dynamicCap=64;dynamicAge=0;constructor(e){this.device=e,this.allocate(Xd)}allocate(e){this.staticCap=e;let t=(2*this.dynamicCap+2*e)*8,n=(this.dynamicCap+e)*16,r=new ArrayBuffer(t*4),i=new ArrayBuffer(n*4);this.target={nodesF:new Float32Array(r),nodesU:new Uint32Array(r),primsF:new Float32Array(i),primsU:new Uint32Array(i)},this.nodes?.destroy(),this.prims?.destroy();let a=GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST;this.nodes=this.device.createBuffer({label:`rt bvh nodes`,size:r.byteLength,usage:a}),this.prims=this.device.createBuffer({label:`rt bvh prims`,size:i.byteLength,usage:a}),this.staticKey=-1,this.version=-1,this.generation++,this.dynamicCount=-1}sync(e){if(e.version===this.version)return;this.version=e.version;let t=e.staticVersion??e.version,n=e.allStatic(),r=e.allDynamic();r.length>this.dynamicCap&&(this.dynamicCap=2**Math.ceil(Math.log2(r.length)),this.allocate(Math.max(this.staticCap,Xd)),this.version=e.version),t!==this.staticKey&&(n.length>this.staticCap&&(this.allocate(Math.max(Xd,2**Math.ceil(Math.log2(n.length)))),this.version=e.version),this.buildStatic(n),this.staticKey=t),this.buildDynamic(r)}buildStatic(e){let t=this.staticBuilder.build(e,this.target,2*this.dynamicCap,this.dynamicCap);this.staticRoot=t.root,this.staticCount=t.primCount,this.staticNodeCount=t.nodeCount,this.staticRebuilds++,t.primCount!==0&&(this.device.queue.writeBuffer(this.nodes,2*this.dynamicCap*32,this.target.nodesU,2*this.dynamicCap*8,t.nodeCount*8),this.device.queue.writeBuffer(this.prims,this.dynamicCap*64,this.target.primsU,this.dynamicCap*16,t.primCount*16))}buildDynamic(e){let t=e.length!==this.dynamicCount||e.length<=64||this.dynamicAge++>=120,n=t?this.dynamicBuilder.build(e,this.target,0,0):this.dynamicBuilder.refit(e);t&&(this.dynamicAge=0),this.dynamicRoot=n.root,this.dynamicCount=n.primCount,this.dynamicNodeCount=n.nodeCount,n.primCount!==0&&(this.device.queue.writeBuffer(this.nodes,0,this.target.nodesU,0,n.nodeCount*8),this.device.queue.writeBuffer(this.prims,0,this.target.primsU,0,n.primCount*16))}slotToPrim(e){return e<this.dynamicCap?{dynamic:!0,index:this.dynamicBuilder.sortedOrder[e]}:{dynamic:!1,index:this.staticBuilder.sortedOrder[e-this.dynamicCap]}}stats(){return{staticPrims:this.staticCount,dynamicPrims:this.dynamicCount,nodes:this.staticNodeCount+this.dynamicNodeCount,bufferBytes:this.nodes.size+this.prims.size,staticRebuilds:this.staticRebuilds}}destroy(){this.nodes.destroy(),this.prims.destroy()}},Qd={r32float:4,rg32float:8,rgba16float:8},$d=class{device;width;height;auxDepth;auxNormal;raw0;raw1;tmpA;tmpB;shadow;gi;spec=null;giHits=null;giVisibility=null;varSum;bytes=0;all=[];constructor(e,t,n){this.device=e,this.width=t,this.height=n,this.auxDepth=[this.make(`rt depth 0`,`r32float`),this.make(`rt depth 1`,`r32float`)],this.auxNormal=[this.make(`rt normal 0`,`rgba16float`),this.make(`rt normal 1`,`rgba16float`)],this.raw0=this.make(`rt raw 0`,`rgba16float`),this.raw1=this.make(`rt raw 1`,`rgba16float`),this.tmpA=this.make(`rt tmp A`,`rgba16float`),this.tmpB=this.make(`rt tmp B`,`rgba16float`),this.shadow=this.history(`shadow`),this.gi=this.history(`gi`),this.varSum=e.createBuffer({label:`rt a-trous variance`,size:this.width*this.height*4,usage:GPUBufferUsage.STORAGE})}ensureSpec(){return this.spec??=this.history(`spec`)}ensureGiHits(){return this.giHits??=[this.make(`rt gi hit 0`,`rg32float`),this.make(`rt gi hit 1`,`rg32float`)]}ensureGiVisibility(){return this.giVisibility??=[this.make(`rt gi visibility 0`,`r32float`),this.make(`rt gi visibility 1`,`r32float`)]}history(e){let t=t=>[this.make(`rt ${e} ${t} 0`,`rgba16float`),this.make(`rt ${e} ${t} 1`,`rgba16float`)];return{hist:t(`history`),mom:t(`moments`)}}make(e,t){let n=GPUTextureUsage,r=this.device.createTexture({label:e,format:t,size:[this.width,this.height],usage:n.STORAGE_BINDING|n.TEXTURE_BINDING|n.COPY_SRC});return this.all.push(r),this.bytes+=this.width*this.height*Qd[t],{texture:r,view:r.createView()}}destroy(){for(let e of this.all)e.destroy();this.all.length=0,this.varSum.destroy()}},ef=256,tf={r:0,g:0,b:0,a:0};function nf(e){let t=e+2654435769>>>0;return t=Math.imul(t^t>>>16,2246822507),t=Math.imul(t^t>>>13,3266489909),(t^t>>>16)>>>0}var rf=class{name=`rt`;rc;layouts;pipes;buffers;probes;paramBuffer;prevPre;probeSampler;clearSky;cloudTexture=null;cloudView=null;canopyTexture=null;canopyView=null;canopyFor=null;sceneTerrain=null;tex=null;groups=null;groupsGeneration=-1;bound=null;terrain=null;testPipeline=null;block=new Zu;options={softness:1,rayRange:300,probeHysteresis:.92,probeRayBudget:null};params={rtWidth:0,rtHeight:0,fullWidth:0,fullHeight:0,divisor:1,maxSteps:0,giRays:0,spec:!1,terrain:!1,staticRoot:0,dynamicRoot:0,visitCap:0,frameIndex:0,debugView:0,seed:0,probeStride:1,probePhase:0,probeLo:[0,0,0],probeRays:0,probePrevLo:[0,0,0],probeAllFresh:!0,probeDim:[1,1,1],softness:1,probeSpacing:1,probeHysteresis:.92,rayRange:300,cloudCenterX:0,cloudCenterZ:0,cloudExtentM:1,cloudSkyGain:1};parity=0;lastFrame=null;seed=0;debugView=0;specWasOn=!1;pass=null;wx=0;wy=0;async init(e){this.rc=e,e.parkLights??=new hr(e.device);let t=e.device;this.layouts=Xu(t),[this.pipes,this.buffers]=await Promise.all([Ku(e,this.layouts),new Zd(t)]),e.rtBuffers=this.buffers,this.probes=new ad(t,e.quality.probes,this.probeLimits(e.quality)),this.paramBuffer=t.createBuffer({label:`rt params`,size:144,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.prevPre=t.createBuffer({label:`rt prev pre-exposure`,size:16,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}),this.probeSampler=t.createSampler({label:`rt probe`,magFilter:`linear`,minFilter:`linear`,addressModeU:`repeat`,addressModeV:`repeat`,addressModeW:`repeat`}),this.clearSky=t.createTexture({label:`rt no cloud shadow`,format:`rgba16float`,size:[1,1],usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST}),t.queue.writeTexture({texture:this.clearSky},new Uint16Array([15360,15360,15360,15360]),{bytesPerRow:8},[1,1]),this.allocate(e)}resize(e){this.allocate(e)}setScene(e,t){this.terrain=t.sampler,this.sceneTerrain=t.terrain,this.probes.reset()}resetLighting(){this.probes.reset()}getAux(){return this.tex?{rtDepth:this.tex.auxDepth[this.parity].view,rtNormal:this.tex.auxNormal[this.parity].view}:null}setDebugView(e){this.debugView=Math.min(6,Math.max(0,Math.round(e)))}setOptions(e){Object.assign(this.options,e)}stats(){let e=this.buffers?.stats(),t=this.rc?.gbuf;return{frame:this.lastFrame??-1,rtWidth:t?.rtWidth??0,rtHeight:t?.rtHeight??0,divisor:this.rc?.quality.rtDivisor??0,giRays:this.rc?.quality.giRays??0,specular:this.rc?.quality.rtSpecular??!1,debugView:this.debugView,staticPrims:e?.staticPrims??0,dynamicPrims:e?.dynamicPrims??0,bvhNodes:e?.nodes??0,bvhBytes:e?.bufferBytes??0,staticRebuilds:e?.staticRebuilds??0,probeCount:this.probes?.total??0,probeRaysPerFrame:this.probes?.raysPerFrame??0,probeStride:this.probes?.stride??0,probeBytes:this.probes?.bytes??0,textureBytes:this.tex?.bytes??0,options:{...this.options}}}async selfTest(){let e=this.rc;return this.testPipeline??=await qu(e,this.layouts),Yd(e,this.layouts,this.testPipeline,this.buffers,this.terrain,ef)}probeLimits(e){let t=nd(e);return this.options.probeRayBudget===null?t:{rayBudget:this.options.probeRayBudget,maxStride:t.maxStride}}syncCanopy(e){let t=e.device;this.canopyTexture||(this.canopyTexture=t.createTexture({label:`rt no canopy`,format:`rgba16float`,size:[1,1],usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST}),t.queue.writeTexture({texture:this.canopyTexture},new Uint16Array(4),{bytesPerRow:8},[1,1]),this.canopyView=this.canopyTexture.createView(),this.groups=null);let n=this.sceneTerrain;if(!n||n===this.canopyFor)return;let r=Vu(n);if(!r)return;let i=Ru;this.canopyTexture.destroy(),this.canopyTexture=t.createTexture({label:`rt canopy shadow`,format:`rgba16float`,size:[i,i],usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST}),t.queue.writeTexture({texture:this.canopyTexture},r,{bytesPerRow:i*8},[i,i]),this.canopyView=this.canopyTexture.createView(),this.canopyFor=n,this.groups=null}allocate(e){this.tex?.destroy(),this.tex=new $d(e.device,e.gbuf.rtWidth,e.gbuf.rtHeight),e.quality.rtSpecular&&this.tex.ensureSpec(),this.bound=e.gbuf,this.groups=null}prepare(e){(!this.tex||this.bound!==e.gbuf)&&this.allocate(e);let t=this.tex;e.quality.giRays===2&&this.pipes.giHits&&!t.giHits&&(t.ensureGiHits(),this.groups=null),e.quality.giRays===2&&this.pipes.giVisibility&&!t.giVisibility&&(t.ensureGiVisibility(),this.groups=null);let n=this.probeLimits(e.quality);this.probes.matches(e.quality.probes,n)||(this.probes.destroy(),this.probes=new ad(e.device,e.quality.probes,n),this.groups=null),e.quality.rtSpecular&&!t.spec&&(t.ensureSpec(),this.groups=null);let r=za(e.device)?.getCloudShadowTexture()??this.clearSky;return r!==this.cloudTexture&&(this.cloudTexture=r,this.cloudView=r.createView(),this.groups=null),this.syncCanopy(e),this.buffers.sync(e.rt),e.parkLights?.setRoots(this.buffers.staticRoot,this.buffers.dynamicRoot),this.groups&&this.groupsGeneration!==this.buffers.generation&&(this.groups=null),this.groups||=(this.groupsGeneration=this.buffers.generation,Yu({rc:e,layouts:this.layouts,tex:t,probes:this.probes,buffers:this.buffers,params:this.paramBuffer,prevPre:this.prevPre,probeSampler:this.probeSampler,cloud:this.cloudView,canopy:this.canopyView})),this.groups}encodeRT(e,t,n){let r=this.prepare(t);n.frameIndex!==this.lastFrame&&this.advance(n),this.writeParams(t,n);let i=t.quality;!i.rtSpecular&&this.specWasOn&&e.beginRenderPass({label:`rt clear specular`,colorAttachments:[{view:t.gbuf.views.giSpecular,loadOp:`clear`,storeOp:`store`,clearValue:tf}]}).end(),this.specWasOn=i.rtSpecular;let a=this.parity;this.wx=Math.ceil(t.gbuf.rtWidth/8),this.wy=Math.ceil(t.gbuf.rtHeight/8);let o=this.probes.useCompact;o&&e.clearBuffer(this.probes.work.args,0,4);let s=t.profiler?.active?t.profiler:void 0,c=this.pass=e.beginComputePass(s?s.computePass(`rt auxiliary`,`rtAux`):{label:`rt`});c.setBindGroup(0,t.frame.group),this.traced(this.pipes.aux,r.aux[a],this.wx,this.wy,1),s&&(c=this.nextProfilePass(e,s,`probes`));let l=this.probes.dim;o?(c.setPipeline(this.pipes.probePlan),c.setBindGroup(1,r.probePlan[a]),c.dispatchWorkgroups(Math.ceil(l[0]/4),Math.ceil(l[1]/4),Math.ceil(l[2]/4)),c.setPipeline(this.pipes.probeCompact),c.setBindGroup(1,t.world.group),c.setBindGroup(2,r.probeCompact[a]),c.dispatchWorkgroupsIndirect(this.probes.work.args,0)):this.traced(this.pipes.probe,r.probe[a],l[0],l[1],l[2]),this.probes.commit(),this.signal(`shadow`,r,a,e,s),this.signal(`gi`,r,a,e,s),i.rtSpecular&&this.signal(`spec`,r,a,e,s),s&&(c=this.nextProfilePass(e,s,`rtLatch`)),c.setPipeline(this.pipes.latch),c.setBindGroup(1,r.latch),c.dispatchWorkgroups(1),c.end(),this.pass=null}local(e,t){let n=this.pass;n.setPipeline(e),n.setBindGroup(1,t),n.dispatchWorkgroups(this.wx,this.wy)}traced(e,t,n,r,i){let a=this.pass;a.setPipeline(e),a.setBindGroup(1,this.rc.world.group),a.setBindGroup(2,t),a.dispatchWorkgroups(n,r,i)}nextProfilePass(e,t,n){this.pass.end();let r=this.pass=e.beginComputePass(t.computePass(`rt ${n}`,n));return r.setBindGroup(0,this.rc.frame.group),r}signal(e,t,n,r,i){let a=e===`spec`?`specular`:e;i&&this.nextProfilePass(r,i,`${a}Rays`),e===`gi`&&this.rc.quality.giRays===2&&this.pipes.giHits&&this.pipes.giShade&&t.giHits&&t.giShade?(this.traced(this.pipes.giHits,t.giHits[n],Math.ceil(this.rc.gbuf.rtWidth/8),Math.ceil(this.rc.gbuf.rtHeight/4),1),this.pipes.giVisibility&&t.giVisibility&&this.traced(this.pipes.giVisibility,t.giVisibility[n],Math.ceil(this.rc.gbuf.rtWidth/8),Math.ceil(this.rc.gbuf.rtHeight/4),1),this.traced(this.pipes.giShade,t.giShade[n],Math.ceil(this.rc.gbuf.rtWidth/8),Math.ceil(this.rc.gbuf.rtHeight/8),1)):this.traced(this.pipes.trace[e],t.trace[e][n],e===`gi`?Math.ceil(this.rc.gbuf.rtWidth/8):this.wx,e===`gi`?Math.ceil(this.rc.gbuf.rtHeight/2):this.wy,1),i&&this.nextProfilePass(r,i,`${a}Denoise`),this.local(this.pipes.temporal[e],t.temporal[e][n]);for(let r=0;r<3;r++)this.local(this.pipes.atrous[e][r],t.atrous[e][n][r])}advance(e){this.lastFrame=e.frameIndex,this.parity^=1,this.seed=nf(e.frameIndex);let[t,,n]=e.camera.pos;this.probes.plan(t,n,this.terrain?this.terrain.heightAt(t,n):0)}writeParams(e,t){let n=this.params,r=e.gbuf,i=e.quality,a=this.probes,o=this.options;n.rtWidth=r.rtWidth,n.rtHeight=r.rtHeight,n.fullWidth=r.width,n.fullHeight=r.height,n.divisor=i.rtDivisor,n.maxSteps=i.rtMaxSteps,n.giRays=i.giRays,n.spec=i.rtSpecular,n.terrain=this.terrain!==null,n.staticRoot=this.buffers.staticRoot,n.dynamicRoot=this.buffers.dynamicRoot,n.visitCap=i.rtMaxSteps*2,n.frameIndex=t.frameIndex,n.debugView=this.debugView,n.seed=this.seed,n.probeStride=a.stride,n.probePhase=t.frameIndex%a.stride,n.probeRays=a.raysPerProbe,n.probeAllFresh=a.allFresh,n.probeLo=a.lo,n.probePrevLo=a.prevLo,n.probeDim=a.dim,n.softness=o.softness,n.probeSpacing=a.spacing,n.probeHysteresis=o.probeHysteresis,n.rayRange=o.rayRange;let s=this.cloudTexture===this.clearSky?null:za(e.device)?.getCloudShadowMapping();n.cloudCenterX=s?.centerX??0,n.cloudCenterZ=s?.centerZ??0,n.cloudExtentM=s?.extentM??1,n.cloudSkyGain=za(e.device)?.getAmbientScale()??1,this.block.write(n),e.device.queue.writeBuffer(this.paramBuffer,0,this.block.buffer)}destroy(){this.tex?.destroy(),this.probes?.destroy(),this.buffers?.destroy(),this.paramBuffer?.destroy(),this.prevPre?.destroy(),this.clearSky?.destroy(),this.canopyTexture?.destroy(),this.tex=null,this.groups=null}};function af(){return new rf}var of=32,sf=1;function cf(e,t){return e*2**t}function lf(e,t,n=of){return Math.min(10,uf(e,t,n)+3)}function uf(e,t,n=of){let r=1;for(;r<10&&n*cf(e,r-1)<t;)r++;return r}function df(e,t,n,r,i,a,o){for(let s=0;s<a;s++){let a=2*cf(i,s);o[2*s]=2*Math.round((e-n)/a),o[2*s+1]=2*Math.round((t-r)/a)}}var ff=class{n=new Float64Array(12);cx=0;cy=0;cz=0;active=!1;disable(){this.active=!1}setFromCamera(e,t,n,r,i=1.05){let a=t[0],o=t[1],s=t[2],c=t[3],l=1-2*(o*o+s*s),u=2*(a*o+c*s),d=2*(a*s-c*o),f=2*(a*o-c*s),p=1-2*(a*a+s*s),m=2*(o*s+c*a),h=-2*(a*s+c*o),g=-2*(o*s-c*a),_=-(1-2*(a*a+o*o)),v=Math.tan(n*.5)*i,y=v*r,b=this.n;b[0]=h*y+l,b[1]=g*y+u,b[2]=_*y+d,b[3]=h*y-l,b[4]=g*y-u,b[5]=_*y-d,b[6]=h*v+f,b[7]=g*v+p,b[8]=_*v+m,b[9]=h*v-f,b[10]=g*v-p,b[11]=_*v-m,this.cx=e[0],this.cy=e[1],this.cz=e[2],this.active=!0}intersectsBox(e,t,n,r,i,a){if(!this.active)return!0;let o=this.n;for(let s=0;s<12;s+=3){let c=o[s],l=o[s+1],u=o[s+2],d=(c>=0?r:e)-this.cx,f=(l>=0?i:t)-this.cy,p=(u>=0?a:n)-this.cz;if(c*d+l*f+u*p<0)return!1}return!0}},pf=class{tiles=new Float32Array(3968);stats={tiles:0,quads:0,culledTiles:0,levels:0};centres=new Int32Array(20);count=0;culled=0;quads=0;originX=0;originZ=0;yMin=0;yMax=0;frustum=null;ringHalf=of;build(e,t,n,r,i,a,o,s,c){df(e,t,n,r,i,a,this.centres),this.count=0,this.culled=0,this.quads=0,this.originX=n,this.originZ=r,this.yMin=o,this.yMax=s,this.frustum=c;for(let e=0;e<a;e++)this.buildLevel(e,i);return this.stats.tiles=this.count,this.stats.quads=this.quads,this.stats.culledTiles=this.culled,this.stats.levels=a,this.count}buildLevel(e,t){let n=this.centres[2*e],r=this.centres[2*e+1],i=this.ringHalf,a=n-i,o=r-i,s=n+i,c=r+i,l=cf(t,e);if(e===0){this.rect(e,l,a,o,s,c);return}let u=this.centres[2*(e-1)]/2-i/2+sf,d=this.centres[2*(e-1)+1]/2-i/2+sf,f=u+i-2,p=d+i-2;this.rect(e,l,a,o,s,d),this.rect(e,l,a,p,s,c),this.rect(e,l,a,d,u,p),this.rect(e,l,f,d,s,p)}rect(e,t,n,r,i,a){let o=i-n,s=a-r;if(o<=0||s<=0)return;let c=Math.ceil(o/16),l=Math.ceil(s/16),u=r;for(let r=0;r<l;r++){let i=Math.floor(s*(r+1)/l)-Math.floor(s*r/l),a=n;for(let n=0;n<c;n++){let r=Math.floor(o*(n+1)/c)-Math.floor(o*n/c);this.tile(e,t,a,u,r,i),a+=r}u+=i}}tile(e,t,n,r,i,a){let o=this.originX+n*t,s=this.originZ+r*t;if(this.frustum&&!this.frustum.intersectsBox(o,this.yMin,s,o+i*t,this.yMax,s+a*t)){this.culled++;return}let c=this.count++*8,l=this.tiles;l[c]=n,l[c+1]=r,l[c+2]=i,l[c+3]=a,l[c+4]=t,l[c+5]=e,l[c+6]=0,l[c+7]=0,this.quads+=i*a}};function mf(){let e=new Uint16Array(1536),t=0;for(let n=0;n<16;n++)for(let r=0;r<16;r++){let i=n*17+r,a=i+1,o=i+17,s=o+1;e[t++]=i,e[t++]=a,e[t++]=s,e[t++]=i,e[t++]=s,e[t++]=o}return e}var hf=Math.log2(512)+1;function gf(e){let t=e.device,n=GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.STORAGE_BINDING,r={width:512,height:512,depthOrArrayLayers:14},i=t.createTexture({label:`terrain-detail-a`,size:r,format:`rgba8unorm`,mipLevelCount:hf,usage:n,viewFormats:[`rgba8unorm-srgb`]}),a=t.createTexture({label:`terrain-detail-b`,size:r,format:`rgba8unorm`,mipLevelCount:hf,usage:n}),o=(e,t)=>e.createView({dimension:`2d-array`,baseMipLevel:t,mipLevelCount:1}),s=t.createComputePipelineAsync({label:`terrain-detail-gen`,layout:`auto`,compute:{module:e.module(`terrain/detail_gen.wgsl`),entryPoint:`main`}}),c=t.createBuffer({label:`terrain-detail-bounds`,size:16,usage:GPUBufferUsage.UNIFORM,mappedAtCreation:!0});new Int32Array(c.getMappedRange()).set([1,0,0,0]),c.unmap();let l=t.createComputePipelineAsync({label:`terrain-detail-mips`,layout:`auto`,compute:{module:e.module(`terrain/detail_mips.wgsl`),entryPoint:`main`}});function u(e,n){let r=t.createCommandEncoder({label:`terrain-detail-init`}),s=t.createBindGroup({layout:e.getBindGroupLayout(0),entries:[{binding:0,resource:o(i,0)},{binding:1,resource:o(a,0)},{binding:2,resource:{buffer:c}}]}),l=r.beginComputePass({label:`detail-gen`});l.setPipeline(e),l.setBindGroup(0,s),l.dispatchWorkgroups(64,64,14),l.end();for(let e=1;e<hf;e++){let s=512>>e,c=t.createBindGroup({layout:n.getBindGroupLayout(0),entries:[{binding:0,resource:o(i,e-1)},{binding:1,resource:o(a,e-1)},{binding:2,resource:o(i,e)},{binding:3,resource:o(a,e)}]});l=r.beginComputePass({label:`detail-mip-${e}`}),l.setPipeline(n),l.setBindGroup(0,c),l.dispatchWorkgroups(Math.ceil(s/8),Math.ceil(s/8),14),l.end()}t.queue.submit([r.finish()])}return{ready:Promise.all([s,l]).then(([e,t])=>u(e,t)),viewA:i.createView({dimension:`2d-array`,format:`rgba8unorm-srgb`,usage:GPUTextureUsage.TEXTURE_BINDING}),viewB:a.createView({dimension:`2d-array`,usage:GPUTextureUsage.TEXTURE_BINDING}),sampler:t.createSampler({addressModeU:`repeat`,addressModeV:`repeat`,magFilter:`linear`,minFilter:`linear`,mipmapFilter:`linear`,maxAnisotropy:8}),destroy(){i.destroy(),a.destroy()}}}var _f=.35,vf=8,yf=class{enabled;n;cell;originX;originZ;farBelow;blocks;wetPrefix;segX=new Int32Array(8);segZ=new Int32Array(8);constructor(e,t,n,r,i,a,o){this.n=t,this.cell=n,this.originX=r[0],this.originZ=r[1],this.farBelow=i+_f*(a-i)<o;let s=Math.ceil(t/vf);this.blocks=s;let c=new Float32Array(s*s).fill(1/0),l=1/0;for(let n=0;n<t;n++){let r=Math.floor(n/vf)*s;for(let i=0;i<t;i++){let a=e[n*t+i],o=r+Math.floor(i/vf);a<c[o]&&(c[o]=a),a<l&&(l=a)}}this.enabled=Number.isFinite(o)&&l<o;let u=s+1;this.wetPrefix=new Uint32Array(u*u);for(let e=0;e<s;e++){let t=0;for(let n=0;n<s;n++)c[e*s+n]<o&&t++,this.wetPrefix[(e+1)*u+n+1]=this.wetPrefix[e*u+n+1]+t}}regionBelow(e,t,n,r){if(!this.enabled)return!1;let i=Math.floor((e-this.originX)/this.cell),a=Math.ceil((n-this.originX)/this.cell),o=Math.floor((t-this.originZ)/this.cell),s=Math.ceil((r-this.originZ)/this.cell);if(this.farBelow&&(i<0||o<0||a>this.n-1||s>this.n-1))return!0;let c=this.fold(i,a,this.segX),l=this.fold(o,s,this.segZ);for(let e=0;e<c;e++)for(let t=0;t<l;t++)if(this.blocksBelow(this.segX[2*e],this.segX[2*e+1],this.segZ[2*t],this.segZ[2*t+1]))return!0;return!1}blocksBelow(e,t,n,r){let i=Math.floor(e/vf),a=Math.floor(t/vf)+1,o=Math.floor(n/vf),s=Math.floor(r/vf)+1;if(a<=i||s<=o)return!1;let c=this.blocks+1,l=this.wetPrefix;return!!(l[s*c+a]-l[o*c+a]-l[s*c+i]+l[o*c+i]>>>0)}reflect(e,t,n){let r=(e%n+n)%n;return r>t?n-r:r}fold(e,t,n){let r=this.n-1,i=2*r;if(t-e>=i)return n[0]=0,n[1]=r,1;let a=0,o=e;for(;o<=t;){let e=Math.floor(o/r),s=Math.min(t,(e+1)*r),c=this.reflect(o,r,i),l=this.reflect(s,r,i);n[2*a]=Math.min(c,l),n[2*a+1]=Math.max(c,l),a++,o=(e+1)*r+1}return a}},bf=class{source;data=new Float32Array(7936);waterCount=0;waterQuads=0;count=-1;originX=NaN;originZ=NaN;mask=null;enabled=!1;bits=new Uint32Array(this.data.buffer);sourceBits;constructor(e){this.source=e,this.sourceBits=new Uint32Array(e.buffer,e.byteOffset,e.length)}invalidate(){this.count=-1}update(e,t,n,r){let i=e*8,a=!!r?.enabled,o=e===this.count&&Object.is(t,this.originX)&&Object.is(n,this.originZ)&&r===this.mask&&a===this.enabled;if(o){for(let e=0;e<i;e++)if(this.sourceBits[e]!==this.bits[e]){o=!1;break}}if(o)return!1;let s=this.source,c=this.data;for(let e=0;e<i;e++)c[e]=s[e];let l=0,u=0;if(r&&r.enabled)for(let i=0;i<e;i++){let a=i*8,o=s[a+4],d=t+s[a]*o,f=n+s[a+1]*o;if(r.regionBelow(d,f,d+s[a+2]*o,f+s[a+3]*o)){let t=(e+l++)*8;for(let e=0;e<8;e++)c[t+e]=s[a+e];u+=c[t+2]*c[t+3]}}return this.count=e,this.originX=t,this.originZ=n,this.mask=r,this.enabled=a,this.waterCount=l,this.waterQuads=u,!0}},xf=1024,Sf=25.5,Cf=new WeakMap;function wf(e,t){Cf.set(e,t)}function Tf(e){return Cf.get(e)}function Ef(e,t,n=xf){let r=e.resolution,i=e.cellSize,[a,o]=e.origin,s=r/n*i,c=(e,t)=>((e-t)/i+.5)/r*n-.5,l=new Float32Array(n*n).fill(1),u=new Float32Array(n*n),d=new Float32Array(n*n);for(let e of t){let t=1.25*e.radius,r=.5*e.radius,i=c(e.x,a),f=c(e.z,o),p=t/s,m=Math.max(0,Math.floor(i-p)),h=Math.min(n-1,Math.ceil(i+p)),g=Math.max(0,Math.floor(f-p)),_=Math.min(n-1,Math.ceil(f+p));for(let a=g;a<=_;a++)for(let o=m;o<=h;o++){let c=Math.hypot(o-i,a-f)*s;if(c>=t)continue;let p=Math.min(Math.max((t-c)/(t-r),0),1),m=e.strength*p*p*(3-2*p),h=a*n+o;l[h]*=1-.5*m,d[h]+=m,e.conifer&&(u[h]+=m)}}let f=new Float32Array(n*n),p=new Float32Array(n*n),m=new Float32Array(n*n);for(let e=0;e<n*n;e++)f[e]=1-l[e];let h=Math.max(1,Math.round(17.5/s));for(let e=0;e<n;e++){let t=0;for(let r=-h;r<=h;r++)t+=f[e*n+Math.min(Math.max(r,0),n-1)];for(let r=0;r<n;r++)p[e*n+r]=t/(2*h+1),t+=f[e*n+Math.min(r+h+1,n-1)]-f[e*n+Math.max(r-h,0)]}for(let e=0;e<n;e++){let t=0;for(let r=-h;r<=h;r++)t+=p[Math.min(Math.max(r,0),n-1)*n+e];for(let r=0;r<n;r++)m[r*n+e]=t/(2*h+1),t+=p[Math.min(r+h+1,n-1)*n+e]-p[Math.max(r-h,0)*n+e]}let g=new Uint8Array(n*n*4);for(let e=0;e<n;e++)for(let t=0;t<n;t++){let r=0,i=0,a=0,o=0;for(let s=-1;s<=1;s++){let c=Math.min(Math.max(e+s,0),n-1);for(let e=-1;e<=1;e++){let s=c*n+Math.min(Math.max(t+e,0),n-1);r+=1-l[s],i+=u[s],a+=d[s],o++}}let s=(e*n+t)*4;g[s]=Math.round(r/o*255),g[s+1]=a>1e-6?Math.round(i/a*255):0,g[s+2]=Math.round(Math.min(m[e*n+t]*2,1)*255),g[s+3]=255}return g}function Df(e,t,n,r,i=xf){let a=e.resolution,o=e.cellSize,[s,c]=e.origin,l=a/i*o,u=(e,t)=>((e-t)/o+.5)/a*i-.5,d=(e,t)=>t+((e+.5)/i*a-.5)*o,f=Sf,p=f/l,m=new Float32Array(i*i).fill(f),h=n?t.length:t.length-1;for(let e=0;e<h;e++){let n=t[e],r=t[(e+1)%t.length],a=n[0],o=n[2],l=r[0]-a,f=r[2]-o,h=l*l+f*f,g=[u(a,s),u(r[0],s)],_=[u(o,c),u(r[2],c)],v=Math.max(0,Math.floor(Math.min(g[0],g[1])-p)),y=Math.min(i-1,Math.ceil(Math.max(g[0],g[1])+p)),b=Math.max(0,Math.floor(Math.min(_[0],_[1])-p)),x=Math.min(i-1,Math.ceil(Math.max(_[0],_[1])+p));for(let e=b;e<=x;e++){let t=d(e,c)-o;for(let n=v;n<=y;n++){let r=d(n,s)-a,o=h>0?Math.min(Math.max((r*l+t*f)/h,0),1):0,c=Math.hypot(r-o*l,t-o*f),u=e*i+n;c<m[u]&&(m[u]=c)}}}for(let e=0;e<i*i;e++)r[e*4+3]=Math.round(Math.min(m[e]/f,1)*255);return r}var Of=1024,kf=new WeakMap;function Af(e,t){kf.set(e,t)}function jf(e){return kf.get(e)}function Mf(e,t,n=Of){let r=e.resolution,i=e.cellSize,[a,o]=e.origin,s=(e,t)=>((e-t)/i+.5)/r*n,c=new Uint8Array(n*n*4);for(let e of t){let t=s(e.x,a),r=s(e.z,o),i=Math.floor(t),l=Math.floor(r);if(i<0||l<0||i>=n||l>=n||e.radius<=0)continue;let u=(l*n+i)*4,d=Math.min(Math.round(e.radius/2*255),255);c[u+3]!==0&&c[u+2]>=d||(c[u]=Math.min(Math.round((t-i)*255),255),c[u+1]=Math.min(Math.round((r-l)*255),255),c[u+2]=Math.max(d,1),c[u+3]=e.conifer?255:128)}return c}var Nf=1536,Pf=289,Ff=-1e9;function If(){let e=null,t=null,n=null,r=null,i=null,a=null,o=null,s=null,c=null,l=null,u=null,d=null,f=new pf,p=new ff,m=new bf(f.tiles),h=new Float32Array(8),g=new Uint32Array(h.buffer),_={levels:0,terrainTiles:0,waterTiles:0,culledTiles:0,vertices:0,triangles:0,draws:0},v=null,y=0,b=null,x=0;return{name:`terrain`,stats:_,init(f){let p=f.device;e=p,m.invalidate(),c=gf(f),l=p.createTexture({label:`terrain-ground-cover`,size:[xf,xf],format:`rgba8unorm`,usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST}),u=p.createTexture({label:`terrain-trunk-grid`,size:[Of,Of],format:`rgba8unorm`,usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST}),d=null,t=p.createBuffer({label:`terrain-tiles`,size:31744,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}),n=p.createBuffer({label:`terrain-params`,size:h.byteLength,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});let g=mf();r=p.createBuffer({label:`terrain-tile-indices`,size:g.byteLength,usage:GPUBufferUsage.INDEX,mappedAtCreation:!0}),new Uint16Array(r.getMappedRange()).set(g),r.unmap();let _=GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,v=p.createBindGroupLayout({label:`terrain-group2`,entries:[{binding:0,visibility:GPUShaderStage.VERTEX,buffer:{type:`read-only-storage`}},{binding:1,visibility:_,buffer:{type:`uniform`}},{binding:2,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:`float`,viewDimension:`2d-array`}},{binding:3,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:`float`,viewDimension:`2d-array`}},{binding:4,visibility:GPUShaderStage.FRAGMENT,sampler:{type:`filtering`}},{binding:5,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:`float`}},{binding:6,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:`float`}}]});i=p.createBindGroup({label:`terrain-group2`,layout:v,entries:[{binding:0,resource:{buffer:t}},{binding:1,resource:{buffer:n}},{binding:2,resource:c.viewA},{binding:3,resource:c.viewB},{binding:4,resource:c.sampler},{binding:5,resource:l.createView()},{binding:6,resource:u.createView()}]});let y=p.createPipelineLayout({bindGroupLayouts:[f.frame.layout,f.world.layout,v]}),b=(e,t)=>{let n=f.module(e);return p.createRenderPipelineAsync({label:t,layout:y,vertex:{module:n,entryPoint:`vs`},fragment:{module:n,entryPoint:`fs`,targets:It},primitive:{topology:`triangle-list`,cullMode:`back`,frontFace:`cw`},depthStencil:Lt})},x=c;s=Promise.all([b(`terrain/terrain.wgsl`,`terrain`),b(`terrain/water.wgsl`,`terrain-water`),x.ready]).then(([e,t])=>{c===x&&(a=e,o=t)})},ready(){return s??Promise.resolve()},setScene(e,t){v=t.terrain,y=t.track?.parkMap?.radius??0,m.invalidate();let n=t.terrain;b=new yf(n.height,n.resolution,n.cellSize,n.origin,n.minHeight,n.maxHeight,n.waterLevel)},update(r,i){if(_.terrainTiles=0,_.waterTiles=0,!v||!e||!t||!n)return;let a=v;if(d!==a&&l){let t=Tf(a);if(t){e.queue.writeTexture({texture:l},t,{bytesPerRow:xf*4},[xf,xf]);let n=jf(a);n&&u&&e.queue.writeTexture({texture:u},n,{bytesPerRow:Of*4},[Of,Of]),d=a}}let o=r.quality;f.ringHalf=Ht(o)?64:32;let s=lf(a.cellSize,o.terrainViewDistance,f.ringHalf),c=i.camera;p.setFromCamera(c.pos,c.quat,c.fovY,c.aspect);let S=f.build(c.pos[0],c.pos[2],a.origin[0],a.origin[1],a.cellSize,s,a.minHeight,a.maxHeight,p),C=m.update(S,a.origin[0],a.origin[1],b),w=m.waterCount;C&&e.queue.writeBuffer(t,0,m.data,0,(S+w)*8),h[0]=b&&b.enabled?a.waterLevel:Ff,h[1]=i.time,g[2]=x,g[3]=o.detailOctaves,g[4]=(o.tier===`low`?0:1)|(Ht(o)?2:0),h[5]=y,h[6]=f.ringHalf,e.queue.writeBuffer(n,0,h),_.levels=s,_.terrainTiles=S,_.waterTiles=w,_.culledTiles=f.stats.culledTiles,_.vertices=(S+w)*Pf,_.triangles=(f.stats.quads+m.waterQuads)*2,_.draws=+(S>0)+ +(w>0)},encodeGBuffer(e){let t=_.terrainTiles;t!==0&&a&&o&&r&&i&&(e.setIndexBuffer(r,`uint16`),e.setBindGroup(2,i),e.setPipeline(a),e.drawIndexed(Nf,t,0,0,0),_.waterTiles>0&&(e.setPipeline(o),e.drawIndexed(Nf,_.waterTiles,0,0,t)))},setDebugView(e){x=Math.max(0,Math.min(6,Math.trunc(e)))},destroy(){t?.destroy(),n?.destroy(),r?.destroy(),c?.destroy(),l?.destroy(),u?.destroy(),u=null,l=null,d=null,t=n=r=null,c=null,i=null,a=o=null}}}var H={bark:0,pineBark:8,birchBark:16,beechBark:24,spruceBark:32,deadWood:40,leaf:128,needle:160,blob:192,cone:224},Lf=1.2,Rf=e=>Math.sqrt(Math.min(Math.max(e,0)/Lf,1)),U=(e,t)=>[e[0]+t[0],e[1]+t[1],e[2]+t[2]],W=(e,t)=>[e[0]-t[0],e[1]-t[1],e[2]-t[2]],G=(e,t)=>[e[0]*t,e[1]*t,e[2]*t],zf=(e,t)=>e[0]*t[0]+e[1]*t[1]+e[2]*t[2],K=(e,t)=>[e[1]*t[2]-e[2]*t[1],e[2]*t[0]-e[0]*t[2],e[0]*t[1]-e[1]*t[0]],Bf=e=>Math.hypot(e[0],e[1],e[2]);function q(e){let t=Bf(e);return t>1e-12?[e[0]/t,e[1]/t,e[2]/t]:[0,1,0]}var Vf=e=>Math.min(Math.max(e,0),1),Hf=e=>Math.round(Vf(e)*255),Uf=class{pos=[];nrm=[];uv=[];attr=[];idx=[];get vertexCount(){return this.pos.length/3}get triangleCount(){return this.idx.length/3}vertex(e){let t=q(e.n);return this.pos.push(e.p[0],e.p[1],e.p[2]),this.nrm.push(t[0],t[1],t[2]),this.uv.push(e.u,e.v),this.attr.push(Hf(e.ao),Hf(e.sway),e.kind,Hf(e.phase)),this.pos.length/3-1}tri(e,t,n){this.idx.push(e,t,n)}quad(e,t,n,r){this.idx.push(e,t,n,e,n,r)}build(){return{vertexCount:this.vertexCount,pos:Float32Array.from(this.pos),nrm:Float32Array.from(this.nrm),uv:Float32Array.from(this.uv),attr:Uint8Array.from(this.attr),idx:Uint32Array.from(this.idx)}}},Wf=1/64,Gf=Math.PI*2;function Kf(e,t,n){let r=Math.exp(-Math.max(n,0)/e.height);if(r<.001)return 1;let i=e.count*t/Gf+e.phase,a=Math.floor(i),o=i-a,s=.55+.9*qf(Math.sin((a%e.count+e.count)%e.count*12.9898+e.phase*78.233)*43758.5453),c=Math.max(Math.cos((o-.5)*Math.PI),0)**2.2;return 1+e.amp*r*(s*c-.12)}var qf=e=>e-Math.floor(e);function Jf(e,t,n){let r=e.seed,i=0;for(let e=0;e<3;e++){let a=2+e+Math.floor(qf(r*(e+1.7))*3),o=.6+1.7*qf(r*(e+3.1)),s=Gf*qf(r*(e+5.3));i+=Math.sin(a*t+o*n+s)*Math.sin(.9*o*n+2.1*s+e)}return 1+e.amp*i/3}function Yf(e,t,n,r){let i=t.length;if(i<2)return;let a=r.sides,o=a+1,s=q(W(t[1],t[0])),c=Math.abs(s[1])<.95?[0,1,0]:[1,0,0],l=q(K(s,c)),u=r.v0??0,d=[],f=[],p=[];for(let e=0;e<i;e++){let o=t[Math.max(e-1,0)],c=t[Math.min(e+1,i-1)],m=q(W(c,o)),h=zf(l,m);l=q([l[0]-m[0]*h,l[1]-m[1]*h,l[2]-m[2]*h]),s=m;let g=K(s,l);e>0&&(u+=Bf(W(t[e],t[e-1]))),p.push(u);let _=r.tip&&e===i-1?0:n[e];for(let n=0;n<=a;n++){let i=n%a/a*Gf,o=Math.cos(i),s=Math.sin(i),c=[l[0]*o+g[0]*s,l[1]*o+g[1]*s,l[2]*o+g[2]*s],p=r.buttress?Kf(r.buttress,i,t[e][1]):1;r.gnarl&&(p*=Jf(r.gnarl,i,u)),f.push(c),d.push([t[e][0]+c[0]*_*p,t[e][1]+c[1]*_*p,t[e][2]+c[2]*_*p])}}let m=e.vertexCount;for(let t=0;t<i;t++){let s=t/(i-1),c=r.tip&&t===i-1?0:n[t];for(let n=0;n<=a;n++){let l=t*o+n,u=d[l],m=W(d[t*o+(n+1)%a],d[t*o+(n+a-1)%a]),h=W(d[Math.min(t+1,i-1)*o+n],d[Math.max(t-1,0)*o+n]),g=K(m,h);(Bf(m)<1e-7||Bf(h)<1e-7||zf(g,f[l])<=0)&&(g=f[l]),e.vertex({p:u,n:g,u:n/a,v:Math.min(p[t]*Wf,1),ao:r.ao(u,s),sway:r.sway(u[1],s),kind:r.kind,phase:Rf(c)})}}for(let t=0;t<i-1;t++)for(let n=0;n<a;n++){let r=m+t*o+n,i=m+(t+1)*o+n;e.quad(r,r+1,i+1,i)}}function Xf(e,t,n,r,i){let[a,o,s,c]=i.rect,l=[[[t[0]-n[0]-r[0],t[1]-n[1]-r[1],t[2]-n[2]-r[2]],a,c],[[t[0]+n[0]-r[0],t[1]+n[1]-r[1],t[2]+n[2]-r[2]],s,c],[[t[0]+n[0]+r[0],t[1]+n[1]+r[1],t[2]+n[2]+r[2]],s,o],[[t[0]-n[0]+r[0],t[1]-n[1]+r[1],t[2]-n[2]+r[2]],a,o]].map(([t,n,r])=>e.vertex({p:t,n:i.normalAt(t),u:n,v:r,ao:i.aoAt(t),sway:i.swayAt(t),kind:i.kind,phase:i.phase}));e.quad(l[0],l[1],l[2],l[3])}function Zf(e,t){let n=Math.abs(e[0])+Math.abs(e[1])+Math.abs(e[2]),r=e[0]/n,i=e[1]/n;if(e[2]/n<0){let e=(1-Math.abs(i))*(r>=0?1:-1),t=(1-Math.abs(r))*(i>=0?1:-1);r=e,i=t}return t[0]=r*.5+.5,t[1]=i*.5+.5,t}function Qf(e){let t=0,n=0;for(let r of e)t+=r.vertexCount,n+=r.idx.length;let r=new Uint8Array(t*24),i=new DataView(r.buffer),a=new Uint32Array(n),o=[],s=[0,0],c=e=>Math.round(Vf(e)*65535),l=0,u=0;for(let t of e){for(let e=0;e<t.vertexCount;e++){let n=(l+e)*24;i.setFloat32(n,t.pos[e*3],!0),i.setFloat32(n+4,t.pos[e*3+1],!0),i.setFloat32(n+8,t.pos[e*3+2],!0),Zf([t.nrm[e*3],t.nrm[e*3+1],t.nrm[e*3+2]],s),i.setUint16(n+12,c(s[0]),!0),i.setUint16(n+14,c(s[1]),!0),i.setUint16(n+16,c(t.uv[e*2]),!0),i.setUint16(n+18,c(t.uv[e*2+1]),!0);for(let i=0;i<4;i++)r[n+20+i]=t.attr[e*4+i]}a.set(t.idx,u),o.push({indexCount:t.idx.length,firstIndex:u,baseVertex:l,vertexCount:t.vertexCount}),l+=t.vertexCount,u+=t.idx.length}return{vertices:r,indices:a,ranges:o}}function J(e,t,n){let r=Math.imul(e|0,668265261)^Math.imul(t|0,374761393)^Math.imul(n|0,2654435761);return r=Math.imul(r^r>>>15,2246822507),r=Math.imul(r^r>>>13,3266489909),r^=r>>>16,(r>>>0)/4294967296}function $f(e,t,n,r){let i=Math.imul(e|0,668265261)^Math.imul(t|0,374761393)^Math.imul(n|0,2246822519)^Math.imul(r|0,2654435761);return i=Math.imul(i^i>>>15,2246822507),i=Math.imul(i^i>>>13,3266489909),i^=i>>>16,(i>>>0)/4294967296}var ep=e=>e*e*(3-2*e);function tp(e,t,n){let r=Math.floor(e),i=Math.floor(t),a=ep(e-r),o=ep(t-i),s=J(r,i,n),c=J(r+1,i,n),l=J(r,i+1,n),u=J(r+1,i+1,n);return s+(c-s)*a+(l-s)*o+(s-c-l+u)*a*o}function np(e,t,n,r){let i=Math.floor(e),a=Math.floor(t),o=Math.floor(n),s=ep(e-i),c=ep(t-a),l=ep(n-o),u=(e,t,n)=>$f(i+e,a+t,o+n,r),d=u(0,0,0)+(u(1,0,0)-u(0,0,0))*s,f=u(0,1,0)+(u(1,1,0)-u(0,1,0))*s,p=u(0,0,1)+(u(1,0,1)-u(0,0,1))*s,m=u(0,1,1)+(u(1,1,1)-u(0,1,1))*s,h=d+(f-d)*c;return h+(p+(m-p)*c-h)*l}function rp(e,t,n,r){let i=0,a=.5,o=0,s=1;for(let c=0;c<r;c++)i+=a*tp(e*s+c*17.3,t*s-c*9.1,n+c*101),o+=a,a*=.5,s*=2;return i/o}function ip(e,t,n,r,i){let a=0,o=.5,s=0,c=1;for(let l=0;l<i;l++)a+=o*np(e*c+l*17.3,t*c-l*9.1,n*c+l*5.7,r+l*101),s+=o,o*=.5,c*=2;return a/s}var Y=(e,t,n)=>{let r=Math.min(Math.max((n-e)/(t-e),0),1);return r*r*(3-2*r)},ap=[5,2,1],op=(e,t,n)=>e+(t-e)*n,sp=(1+Math.sqrt(5))/2,cp=[[-1,sp,0],[1,sp,0],[-1,-sp,0],[1,-sp,0],[0,-1,sp],[0,1,sp],[0,-1,-sp],[0,1,-sp],[sp,0,-1],[sp,0,1],[-sp,0,-1],[-sp,0,1]],lp=[[0,11,5],[0,5,1],[0,1,7],[0,7,10],[0,10,11],[1,5,9],[5,11,4],[11,10,2],[10,7,6],[7,1,8],[3,9,4],[3,4,2],[3,2,6],[3,6,8],[3,8,9],[4,9,5],[2,4,11],[6,2,10],[8,6,7],[9,8,1]];function up(e){let t=[],n=[],r=new Map,i=e=>{let n=q(e),i=`${Math.round(n[0]*1e5)},${Math.round(n[1]*1e5)},${Math.round(n[2]*1e5)}`,a=r.get(i);return a===void 0&&(a=t.length,r.set(i,a),t.push(n)),a};for(let[t,r,a]of lp){let o=cp[t],s=cp[r],c=cp[a],l=(t,n)=>i(U(o,U(G(W(s,o),t/e),G(W(c,o),n/e))));for(let t=0;t<e;t++)for(let r=0;r<e-t;r++)n.push(l(t,r),l(t+1,r),l(t,r+1)),r<e-t-1&&n.push(l(t+1,r),l(t+1,r+1),l(t,r+1))}return{dirs:t,tris:n}}function dp(e,t){let n=e.range(-1,1)*t,r=e.range(0,Math.PI*2),i=Math.sqrt(Math.max(1-n*n,0));return q([i*Math.cos(r),n,i*Math.sin(r)])}function fp(e){let t=new ue(O(11276,e)),n=(e,n,r,i)=>Array.from({length:e},()=>[dp(t,n),t.range(r,i)]),r=O(11277,e);switch(e){case 0:return{planes:n(11,1,.78,1),sharp:26,stretch:[1,.9,1.05],amp:.05,freq:2.6,facet:.55,ledge:.03,seed:r};case 1:return{planes:n(7,1,.86,1),sharp:7,stretch:[1.05,.8,.95],amp:.07,freq:1.6,facet:0,ledge:0,seed:r};case 2:return{planes:[[[0,1,0],.4],[[0,-1,0],.4],...n(6,.3,.82,1)],sharp:22,stretch:[1,1,.8],amp:.04,freq:2.2,facet:.4,ledge:.06,seed:r};default:return{planes:n(9,1,.8,1),sharp:16,stretch:[.7,1.35,.75],amp:.06,freq:2.2,facet:.35,ledge:.04,seed:r}}}function pp(e,t){let n=e.planes.map(([e,n])=>{let r=zf(t,e);return r>.02?n/r:1/0}),r=Math.min(...n),i=0;for(let t of n)t<1/0&&(i+=Math.exp(-e.sharp*(t-r)));let a=r===1/0?1.4:Math.min(r-Math.log(i)/e.sharp,1.6),o=ip(t[0]*e.freq+3.1,t[1]*e.freq,t[2]*e.freq,e.seed,3);a*=1+e.amp*(2*op(o,Math.floor(o*6)/6,e.facet)-1);let s=G(t,a);if(e.ledge>0){let t=s[1]*3.5+1.5*o,n=1+e.ledge*(t-Math.floor(t)-.5);s=[s[0]*n,s[1],s[2]*n]}return[s[0]*e.stretch[0],s[1]*e.stretch[1],s[2]*e.stretch[2]]}function mp(e,t,n){let r=e.map(()=>[0,0,0]);for(let t=0;t<n.length;t+=3){let i=e[n[t]],a=e[n[t+1]],o=e[n[t+2]],s=K(W(a,i),W(o,i));zf(s,U(i,U(a,o)))<0&&(s=G(s,-1));for(let e=0;e<3;e++)r[n[t+e]]=U(r[n[t+e]],s)}let i=new Uf;e.forEach((e,n)=>{i.vertex({p:e,n:r[n],u:0,v:0,ao:.4+.6*Y(-.7,.5,t[n][1]),sway:0,kind:0,phase:0})});for(let e=0;e<n.length;e+=3)i.tri(n[e],n[e+1],n[e+2]);return i.build()}function hp(e){let t=fp(e),n=up(ap[0]),r=0,i=1/0,a=-1/0;for(let e of n.dirs){let n=pp(t,e);r=Math.max(r,Math.hypot(n[0],n[1],n[2])),i=Math.min(i,n[1]),a=Math.max(a,n[1])}let o=1/r,s=-i*o,c=ap.map(e=>{let r=e===ap[0]?n:up(e);return mp(r.dirs.map(e=>{let n=pp(t,e);return[n[0]*o,n[1]*o+s,n[2]*o]}),r.dirs,r.tris)}),l=(a-i)*o,u=0;for(let e of c)for(let t=0;t<e.vertexCount;t++)u=Math.max(u,Math.hypot(e.pos[t*3],e.pos[t*3+1]-l/2,e.pos[t*3+2]));return{lods:c,height:l,centreY:l/2,radius:u}}var gp=null;function _p(){return gp??=Array.from({length:4},(e,t)=>hp(t)),gp}function vp(){return typeof MessageChannel>`u`?new Promise(e=>setTimeout(e,0)):new Promise(e=>{let t=new MessageChannel;t.port1.onmessage=()=>{t.port1.close(),e()},t.port2.postMessage(0)})}async function yp(e,t=8,n=vp){let r=performance.now(),i=e.next();for(;!i.done;)performance.now()-r>=t&&(await n(),r=performance.now()),i=e.next();return i.value}var bp=.4,xp=7,Sp=.001,Cp=(e,t)=>[e[0]-t[0],e[1]-t[1],e[2]-t[2]],X=(e,t)=>e[0]*t[0]+e[1]*t[1]+e[2]*t[2],wp=(e,t)=>[e[1]*t[2]-e[2]*t[1],e[2]*t[0]-e[0]*t[2],e[0]*t[1]-e[1]*t[0]];function Tp(e){let t=[1/0,1/0,1/0],n=[-1/0,-1/0,-1/0];for(let r of e)for(let e=0;e<3;e++)t[e]=Math.min(t[e],r[e]),n[e]=Math.max(n[e],r[e]);return[t,n]}function Ep(e,t,n){let r=e.map(e=>X(t,e)-n),i=[];for(let t=0;t<3;t++){let n=(t+1)%3;if(r[t]>0!=r[n]>0){let a=r[t]/(r[t]-r[n]);i.push([e[t][0]+(e[n][0]-e[t][0])*a,e[t][1]+(e[n][1]-e[t][1])*a,e[t][2]+(e[n][2]-e[t][2])*a])}}return i.length===2?[i[0],i[1]]:null}function Dp(e,t){let n=Cp(e[1],e[0]),r=Cp(e[2],e[0]),i=Cp(t,e[0]),a=X(n,n),o=X(n,r),s=X(r,r),c=X(i,n),l=X(i,r),u=a*s-o*o||1e-12,d=(s*c-o*l)/u,f=(a*l-o*c)/u;return[1-d-f,d,f]}function Op(e,t,n,r=!1){let[i,a,o]=t,s=e.uv[i][0]*n[0]+e.uv[a][0]*n[1]+e.uv[o][0]*n[2],c=e.uv[i][1]*n[0]+e.uv[a][1]*n[1]+e.uv[o][1]*n[2];return r?e.near(s,c):e.opaque(s,c)}var kp=new WeakMap;function Ap(e,t){let n=t===e.pos?kp.get(t):void 0;return n||(n=e.tris.map(e=>Tp(e.map(e=>t[e]))),t===e.pos&&kp.set(t,n)),n}var jp=e=>{let t=[];for(let n=0;n<=e;n++)for(let r=0;r<=e-n;r++)t.push([n/e,r/e,(e-n-r)/e]);return t},Mp=jp(12),Np=jp(4),Pp=.04,Fp=.03,Ip=new WeakMap,Lp=new WeakMap;function Rp(e,t,n){let r=n?Lp:Ip,i=r.get(e.uv);return i||(i=e.tris.map(t=>{let r=Math.max(...[[0,1],[1,2],[2,0]].map(([n,r])=>Math.hypot(...Cp(e.pos[t[n]],e.pos[t[r]])))),i=n?4:Math.min(12,Math.max(2,Math.ceil(r/Pp)));return(i===12?Mp:i===4&&n?Np:jp(i)).filter(n=>Op(e,t,n,!0))}),r.set(e.uv,i)),i[t]}var zp=new WeakMap;function Bp(e){let t=zp.get(e.pos);return t||(t=e.tris.map(t=>{let n=wp(Cp(e.pos[t[1]],e.pos[t[0]]),Cp(e.pos[t[2]],e.pos[t[0]])),r=Math.hypot(n[0],n[1],n[2]);if(r<1e-9)return null;let i=[n[0]/r,n[1]/r,n[2]/r];return{n:i,d:X(i,e.pos[t[0]])}}),zp.set(e.pos,t)),t}function Vp(e,t,n){let r=Ap(e,e.pos),i=Ap(t,t.pos),a=Bp(e);for(let o=0;o<e.tris.length;o++){let s=a[o];if(!s)continue;let[c,l]=r[o],u=e.tris[o],d=u.map(t=>e.pos[t]),{n:f,d:p}=s;for(let r=0;r<t.tris.length;r++){let[a,o]=i[r];if(l[0]+n<a[0]||c[0]-n>o[0]||l[1]+n<a[1]||c[1]-n>o[1]||l[2]+n<a[2]||c[2]-n>o[2])continue;let s=t.tris[r].map(e=>t.pos[e]),m=X(f,s[0])-p,h=X(f,s[1])-p,g=X(f,s[2])-p;if(m>=n&&h>=n&&g>=n||m<=-n&&h<=-n&&g<=-n)continue;let _=Dp(d,Cp(s[0],[f[0]*m,f[1]*m,f[2]*m])),v=Dp(d,Cp(s[1],[f[0]*h,f[1]*h,f[2]*h])),y=Dp(d,Cp(s[2],[f[0]*g,f[1]*g,f[2]*g]));if(!(_[0]<0&&v[0]<0&&y[0]<0||_[1]<0&&v[1]<0&&y[1]<0||_[2]<0&&v[2]<0&&y[2]<0))for(let i of Rp(t,r,n>=Fp)){let t=m*i[0]+h*i[1]+g*i[2];if(t>=n||t<=-n)continue;let r=[_[0]*i[0]+v[0]*i[1]+y[0]*i[2],_[1]*i[0]+v[1]*i[1]+y[1]*i[2],_[2]*i[0]+v[2]*i[1]+y[2]*i[2]];if(!(r[0]<0||r[1]<0||r[2]<0)&&Op(e,u,r,!0))return!0}}}return!1}function Hp(e,t,n,r){(t[0][0]>r[0][0]||t[0][0]===r[0][0]&&t[0][2]>r[0][2])&&([e,t,n,r]=[n,r,e,t]);let i=Ap(e,t),a=Ap(n,r);for(let o=0;o<e.tris.length;o++){let[s,c]=i[o];for(let i=0;i<n.tris.length;i++){let[l,u]=a[i];if(c[0]<l[0]||s[0]>u[0]||c[1]<l[1]||s[1]>u[1]||c[2]<l[2]||s[2]>u[2])continue;let d=e.tris[o],f=n.tris[i],p=t[d[0]],m=t[d[1]],h=t[d[2]],g=r[f[0]],_=r[f[1]],v=r[f[2]],y=wp(Cp(m,p),Cp(h,p)),b=X(y,p),x=X(y,g)-b,S=X(y,_)-b,C=X(y,v)-b;if(x>0&&S>0&&C>0||x<=0&&S<=0&&C<=0)continue;let w=wp(Cp(_,g),Cp(v,g)),T=X(w,g),E=X(w,p)-T,D=X(w,m)-T,O=X(w,h)-T;if(E>0&&D>0&&O>0||E<=0&&D<=0&&O<=0||X(y,y)<1e-14||X(w,w)<1e-14)continue;let k=[p,m,h],A=[g,_,v],j=Ep(k,w,T),M=Ep(A,y,b);if(!j||!M)continue;let ee=wp(y,w),te=X(ee,j[0]),ne=X(ee,j[1]),re=X(ee,M[0]),ie=X(ee,M[1]),ae=Math.max(Math.min(te,ne),Math.min(re,ie)),oe=Math.min(Math.max(te,ne),Math.max(re,ie));if(oe-ae<=Sp*Math.hypot(ee[0],ee[1],ee[2]))continue;let se=ne-te||1e-12;for(let t=0;t<xp;t++){let r=(ae+(oe-ae)*(t+.5)/xp-te)/se,i=[j[0][0]+(j[1][0]-j[0][0])*r,j[0][1]+(j[1][1]-j[0][1])*r,j[0][2]+(j[1][2]-j[0][2])*r];if(Op(e,d,Dp(k,i))&&Op(n,f,Dp(A,i)))return!0}}}return!1}var Up=class e{cells=new Map;placed=0;dropped=0;room=0;spread=0;keys(e,t){let n=[];for(let r=Math.floor(e[0]/bp);r<=Math.floor(t[0]/bp);r++)for(let i=Math.floor(e[1]/bp);i<=Math.floor(t[1]/bp);i++)for(let a=Math.floor(e[2]/bp);a<=Math.floor(t[2]/bp);a++)n.push(((r+1024)*2048+i+1024)*2048+a+1024);return n}query=0;neighbours(e,t,n){let r=[],i=++this.query,a=[e[0]-n,e[1]-n,e[2]-n],o=[t[0]+n,t[1]+n,t[2]+n];for(let e of this.keys(a,o))for(let t of this.cells.get(e)??[])t.seen===i||t.hi[0]<a[0]||t.lo[0]>o[0]||t.hi[1]<a[1]||t.lo[1]>o[1]||t.hi[2]<a[2]||t.lo[2]>o[2]||(t.seen=i,r.push(t));return r}clashes(e,t){let[n,r]=Tp(e.pos);return this.neighbours(n,r,Math.max(e.room,this.room)+(e.spread??0)+this.spread).some(i=>{if(i.piece.group===e.group||i.piece===t)return!1;let a=Math.max(e.room,i.piece.room)+(e.spread??0)+(i.piece.spread??0);for(let e=0;e<3;e++)if(i.lo[e]>r[e]+a||i.hi[e]<n[e]-a)return!1;return Hp(e,e.pos,i.piece,i.piece.pos)||Vp(e,i.piece,a)||Vp(i.piece,e,a)})}place(e,t,n){for(let r=0;;r++){let i=e(r);if(!i)break;if(!this.clashes(i)&&!t?.clashes(i,n))return this.add(i),t?.add(i),i}return this.dropped++,null}static of(t){let n=new e;for(let e of t)n.add(e);return n}add(e){let[t,n]=Tp(e.pos),r={piece:e,lo:t,hi:n,id:this.placed,seen:0};for(let e of this.keys(t,n)){let t=this.cells.get(e);t||this.cells.set(e,t=[]),t.push(r)}this.placed++,this.room=Math.max(this.room,e.room),this.spread=Math.max(this.spread,e.spread??0)}countCrossings(t){let n=new Set;for(let e of this.cells.values())for(let t of e)n.add(t);if(t)return e.of([...n].map(e=>({...e.piece,pos:e.piece.pos.map(t)}))).countCrossings();let r=0;for(let e of n)for(let t of this.neighbours(e.lo,e.hi,0))t.id<=e.id||t.piece.group===e.piece.group||Hp(e.piece,e.piece.pos,t.piece,t.piece.pos)&&r++;return r}},Wp=Math.PI*2,Gp=e=>Math.min(Math.max(e,0),1),Kp=()=>({shade:0,hue:0,thin:1,tu:0,tv:0,open:1}),qp=class{n;cells;constructor(e){this.n=e,this.cells=Array.from({length:e*e},()=>[])}cell(e){return Math.min(Math.max(Math.floor(e*this.n),0),this.n-1)}add(e,t,n,r,i){for(let a=this.cell(n);a<=this.cell(i);a++)for(let n=this.cell(t);n<=this.cell(r);n++)this.cells[a*this.n+n].push(e)}at(e,t){return this.cells[this.cell(t)*this.n+this.cell(e)]}};function Jp(e){return .62+.38*e.next()}function Yp(e){let t=e.next();return t<.015?.85+.15*e.next():t<.1?.28+.22*e.next():.12*e.next()}function Xp(e,t,n,r,i,a,o,s,c=1){let l=Yp(e),u=[];if(e.next()<.14)for(let t=e.int(1,3);t>0;t--)u.push([e.range(.2,.85),e.range(-.7,.7),e.range(.02,.05)]);let d=e.next()<.06?e.range(.08,.22):0,f=e.next()<.06?[e.range(.35,.8),e.range(-.5,.5),e.range(.05,.11)]:[0,0,0];return{bx:t,by:n,dx:Math.sin(r),dy:-Math.cos(r),len:i,w:a,shade:Jp(e)*(l>.8?.78:1),hue:l,open:c,lobes:o,lobeAmp:s,lobePhase:e.range(0,Wp),bias:e.range(-.5,.5),roll:e.range(-.4,.4),petiole:.06,widest:.72,teeth:0,toothAmp:0,spots:u,burn:d,hole:f,seed:e.next()*2147483647|0,fold:e.range(.3,.75),curl:e.range(.3,.9)}}var Zp=.7,Qp=.42,$p=.5,em=.92;function tm(e,t,n,r){let i=t-e.bx,a=n-e.by,o=(i*e.dx+a*e.dy)/e.len;if(o<=0||o>=1)return!1;let s=-i*e.dy+a*e.dx,c=Math.abs(s),l=e.lobeAmp>.2?1-e.lobeAmp*(1-Math.abs(Math.sin(o*e.lobes*Math.PI+e.lobePhase))**.5):1+e.lobeAmp*Math.sin(o*e.lobes*Wp+e.lobePhase);if(e.teeth>0){let t=o*e.teeth+(s>=0?0:.5),n=t*3;l*=1-e.toothAmp*(t-Math.floor(t))-.35*e.toothAmp*(n-Math.floor(n))}let u=e.w*Math.sin(Math.PI*o**+e.widest)*l;if(c>=u||e.hole[2]>0&&Math.hypot((o-e.hole[0])*e.len,s-e.hole[1]*e.w)<e.hole[2]*e.len)return!1;let d=c/u,f=o*7-d*1.5,p=Gp(1-Math.abs(f-Math.floor(f)-.5)/.09),m=Gp(1-c/(.004+.012*e.w*(1-o)*10)),h=tp(o*e.len*120,s*120,e.seed),g=e.shade*(.84+.16*p+.22*m)*(1-.14*d)*(.9+.2*h),_=Math.min(e.hue+.12*p+.25*m+.1*d**6,1),v=1-.7*Math.max(.6*p,m);for(let[t,n,r]of e.spots){let i=Math.hypot((o-t)*e.len,s-n*e.w*.6)/(r*e.len);i<1?(_=Math.max(_,.82+.18*(1-i)),g*=.62+.3*i,v*=.6):i<1.7&&(_=Math.max(_,Math.min(_+.4*(1.7-i),.6)))}e.burn>0&&d>1-e.burn*(.6+.8*h)&&(_=.93+.07*h,g*=.72,v*=.5),r.shade=g,r.hue=_,r.thin=v;let y=(s>=0?1:-1)*(e.fold*d**.8+.25*d**4)+e.roll,b=e.bias-e.curl*(o*o-.33);return r.tu=y*-e.dy+b*e.dx,r.tv=y*e.dx+b*e.dy,r.open=e.open,!0}function nm(e,t,n,r){let i=t-e.bx,a=n-e.by,o=i*e.dx+a*e.dy;return o>.02*e.len||o<-e.petiole||Math.abs(-i*e.dy+a*e.dx)>=.0045?!1:(r.shade=Zp,r.hue=Qp,r.thin=.3,r.tu=0,r.tv=0,r.open=e.open,!0)}function rm(e){let t=e.bx+e.dx*e.len,n=e.by+e.dy*e.len,r=e.w*(1+e.lobeAmp)+.006,i=-e.dy*r,a=e.dx*r;return[Math.min(e.bx,t)-Math.abs(i),Math.min(e.by,n)-Math.abs(a),Math.max(e.bx,t)+Math.abs(i),Math.max(e.by,n)+Math.abs(a)]}function im(e,t,n){let r=e.bx-e.ax,i=e.by-e.ay,a=Gp(((t-e.ax)*r+(n-e.ay)*i)/(r*r+i*i+1e-12));return Math.hypot(t-(e.ax+r*a),n-(e.ay+i*a))<e.r0+(e.r1-e.r0)*a}var am=[[-.006,-.01],[-.012,-.02],[-.02,-.032]],om=.5;function sm(e,t,n=null){let r=new qp(12),i=new qp(12);for(let t of e){let[e,n,i,a]=rm(t);r.add(t,e-t.petiole,n-t.petiole,i+t.petiole,a+t.petiole)}for(let e of t){let t=Math.max(e.r0,e.r1);i.add(e,Math.min(e.ax,e.bx)-t,Math.min(e.ay,e.by)-t,Math.max(e.ax,e.bx)+t,Math.max(e.ay,e.by)+t)}let a=new Map(e.map((e,t)=>[e,t])),o=Kp(),s=(e,t,n)=>{let i=a.get(e),s=0;for(let[e,c]of am){let l=r.at(t+e,n+c);for(let r=l.length-1;r>=0&&a.get(l[r])>i;r--)if(tm(l[r],t+e,n+c,o)){s++;break}}return s},c=(e,t,a)=>{let o=r.at(e,t);for(let n=o.length-1;n>=0;n--){if(!tm(o[n],e,t,a))continue;let r=s(o[n],e,t);return r>0&&(a.open*=1-1.4*om*r/am.length),!0}for(let n=o.length-1;n>=0;n--)if(nm(o[n],e,t,a))return!0;for(let n of i.at(e,t))if(im(n,e,t))return a.shade=$p,a.hue=em,a.thin=0,a.tu=0,a.tv=0,a.open=.7,!0;return n?n(e,t,a):!1};return c.layout={leaves:e,twigs:t},c}function cm(e,t=.02,n=.9){for(let r=0;r<12;r++){let[r,i,a,o]=rm(e);if(r>=t&&i>=t&&a<=1-t&&o<=n)break;e.len*=.88,e.w*=.88}return e}function lm(e,t,n,r,i,a){let o=[[e,t]];for(let s=1;s<=a;s++){let c=n+s/a*i;e+=Math.sin(c)*r/a,t-=Math.cos(c)*r/a,o.push([e,t])}return{pts:o}}function um(e,t){let n=Gp(t)*(e.pts.length-1),r=Math.min(Math.floor(n),e.pts.length-2),i=n-r,a=e.pts[r],o=e.pts[r+1];return[a[0]+(o[0]-a[0])*i,a[1]+(o[1]-a[1])*i,Math.atan2(o[0]-a[0],-(o[1]-a[1]))]}function dm(e,t,n,r){let i=e.pts.length-1;for(let a=0;a<i;a++)r.push({ax:e.pts[a][0],ay:e.pts[a][1],bx:e.pts[a+1][0],by:e.pts[a+1][1],r0:t+(n-t)*(a/i),r1:t+(n-t)*((a+1)/i)})}function fm(e){let t=[],n=[],r=(n,r,i,a,o)=>{let s=Xp(e,n,r,i,a,a*e.range(.27,.33),e.range(3.6,5),e.range(.42,.58),o);s.widest=e.range(1.25,1.6),s.petiole=.012,s.bias=e.range(-.35,.35),s.roll=e.range(-.3,.3),t.push(cm(s))},i=[.5+e.range(-.03,.03),e.range(.74,.8)],a=lm(.5,.965,e.range(-.08,.08),.965-i[1],e.range(-.15,.15),4);dm(a,.008,.0055,n);let o=e.int(4,5),s=um(a,1);for(let t=0;t<3;t++){let[n,i,o]=um(a,e.range(.25,.6));r(n,i,o+(t===0?-1:1)*e.range(.9,1.4),e.range(.16,.21),.6)}let c=[];for(let t=0;t<o;t++){let r=o===1?0:-.75+1.5*(t/(o-1)),i=lm(s[0],s[1],r+e.range(-.15,.15),e.range(.26,.38)*(1-.2*Math.abs(r)),e.range(-.3,.3),3);dm(i,.005,.0035,n),c.push(i)}for(let t of c){let[n,i,a]=um(t,.5);r(n,i,a+(e.next()<.5?-1:1)*e.range(.9,1.3),e.range(.13,.18),.7)}for(let n of c){let[i,a,o]=um(n,1),s=e.int(6,8),c=Array.from({length:s},(t,n)=>-1.45+2.9*(n+e.range(-.25,.25))/(s-1)).sort((e,t)=>Math.abs(t)-Math.abs(e));for(let n of c){let s=1-Math.abs(n)/1.6,c=e.range(.16,.2)+.06*s;r(i,a,o+n,c,.78+.22*s),s>.6&&e.next()<.35&&(t[t.length-1].hue=Math.min(t[t.length-1].hue+.1,.45))}}return sm(t,n)}function pm(e){let t=[],n=[],r=(n,r,i,a,o)=>{let s=Xp(e,n,r,i,a,a*e.range(.34,.4),0,0,o);s.widest=e.range(.55,.7),s.teeth=e.range(7,9),s.toothAmp=e.range(.08,.13),s.petiole=a*e.range(.25,.4),s.bx+=s.dx*s.petiole,s.by+=s.dy*s.petiole,t.push(cm(s))},i=e.next()<.5?-1:1,a=lm(.5,.965,i*e.range(.05,.2),e.range(.78,.86),-i*e.range(.4,.8),8);dm(a,.0055,.0025,n);let o=lm(...um(a,e.range(.3,.4)).slice(0,2),-i*e.range(.5,.8),e.range(.32,.42),i*e.range(.4,.8),5);dm(o,.004,.002,n);for(let[t,i]of[[a,e.int(18,22)],[o,e.int(11,14)]])for(let a=0;a<i;a++){let o=.12+.86*(a+e.range(-.2,.2))/i,[s,c,l]=um(t,o),u=a%2==0?1:-1;if(e.next()<.45){let t=l+u*e.range(.7,1.1),i=e.range(.012,.025),a=s+Math.sin(t)*i,o=c-Math.cos(t)*i;n.push({ax:s,ay:c,bx:a,by:o,r0:.0035,r1:.003});for(let n=e.int(2,3);n>0;n--)r(a,o,t+e.range(-.8,.8),e.range(.12,.16),.85)}else r(s,c,l+u*e.range(.5,1.2),e.range(.12,.17)*(1-.2*o),.9)}return sm(t,n)}function mm(e){let t=[],n=e.range(0,Wp),r=e.range(0,Wp),i=e.range(0,Wp);for(let a=0;a<760;a++){let a=e.range(0,Wp),o=Math.sqrt(e.next()),s=.8+.12*Math.sin(3*a+n)+.08*Math.sin(5*a+r)+.04*Math.sin(9*a+i);if(o>.72&&e.next()<(o-.72)*2.4)continue;let c=.5+Math.cos(a)*o*.42*s,l=.5+Math.sin(a)*o*.39*s,u=e.range(.07,.11)*(1-.25*o),d=e.range(0,Wp),f=(.3+.7*Gp((o-.1)/.9))*(.82+.18*Gp(1-l)),p=Xp(e,c-Math.sin(d)*u*.5,l+Math.cos(d)*u*.5,d,u,u*e.range(.32,.42),3,.1,f);p.petiole=0,t.push(p)}let a=Array.from({length:12},(t,n)=>{let r=e.range(0,Wp),i=n<8?e.range(0,.28):e.range(.28,.4);return[.5+Math.cos(r)*i,.5+Math.sin(r)*i*.9,n<8?e.range(.016,.034):e.range(.03,.055)]}),o=sm(t,[]);return(e,t,n)=>{for(let n of a)if(Math.hypot(e-n[0],t-n[1])<n[2])return!1;return o(e,t,n)}}function hm(e){let t=[],n=[],r=lm(.5,.965,e.range(-.1,.1),.82,e.range(-.3,.3),7);dm(r,.007,.003,n);let i=e.int(9,11);for(let n=0;n<i;n++){let a=.1+.88*(n+e.range(-.15,.15))/i,[o,s,c]=um(r,a),l=e.range(.2,.26)*(1-.3*a)+(n===i-1?.04:0),u=Xp(e,o,s,c+(n%2==0?1:-1)*e.range(.7,1.15)*(n===i-1?.1:1),l,l*e.range(.4,.46),0,0,.7+.3*a);u.widest=e.range(.85,1.05),u.teeth=e.range(9,12),u.toothAmp=e.range(.05,.09),u.petiole=.02,u.shade=Math.min(u.shade*1.1,1),t.push(cm(u))}return sm(t,n)}function gm(e){let t=[],n=[],r=(n,r,i,a,o)=>{let s=Xp(e,n,r,i,a,a*e.range(.3,.36),e.range(5,8),e.range(.035,.06),o);s.widest=e.range(.7,.85),s.petiole=.012,s.roll=e.range(-.15,.15),t.push(cm(s))},i=lm(.5,.965,e.range(-.12,.12),.84,e.range(-.35,.35),9);dm(i,.0055,.0025,n);let a=[i];for(let t=e.int(2,3);t>0;t--){let[r,o,s]=um(i,e.range(.2,.55)),c=t%2==0?1:-1,l=lm(r,o,s+c*e.range(.6,.95),e.range(.3,.42),-c*e.range(.1,.4),6);dm(l,.0035,.0018,n),a.push(l)}for(let t of a){let n=e.int(8,10);for(let i=0;i<n;i++){let a=.1+.88*(i+e.range(-.2,.2))/n,[o,s,c]=um(t,a);r(o,s,c+(i===n-1?e.range(-.15,.15):(i%2==0?1:-1)*e.range(.85,1.25)),e.range(.16,.22)*(1-.25*a),.75+.25*a)}}return sm(t,n)}function _m(e){let t=[],n=[],r=lm(.5,.965,e.range(-.1,.1),.82,e.range(-.25,.25),7);dm(r,.0065,.003,n);let i=e.int(6,8);for(let a=0;a<i;a++){let o=.12+.86*(a+e.range(-.2,.2))/i,[s,c,l]=um(r,o),u=l+(a%2==0?1:-1)*e.range(.5,1),d=e.range(.01,.03),f=s+Math.sin(u)*d,p=c-Math.cos(u)*d;n.push({ax:s,ay:c,bx:f,by:p,r0:.004,r1:.003});for(let n=e.int(2,4);n>0;n--){let n=e.range(.1,.15),r=Xp(e,f,p,u+e.range(-1.1,1.1),n,n*e.range(.36,.44),e.range(2.6,3.4),e.range(.55,.7),.75+.25*o);r.widest=e.range(1.1,1.4),r.petiole=.015,t.push(cm(r))}}return sm(t,n)}var vm=.97,ym=.88,bm=.03,xm=.47;function Sm(e,t){let n=[],r=1/4,i=.85*r;for(let a=0;a<4;a++)for(let o=0;o<4;o++){let s=(o+.5)*r,c=(a+ym)*r,l={oak:{ratio:e.range(.27,.33),lobes:e.range(3.6,5),amp:e.range(.42,.58),widest:e.range(1.25,1.6),teeth:0,tooth:0},birch:{ratio:e.range(.34,.4),lobes:0,amp:0,widest:e.range(.55,.7),teeth:e.range(7,9),tooth:e.range(.08,.13)},beech:{ratio:e.range(.3,.36),lobes:e.range(5,8),amp:e.range(.035,.06),widest:e.range(.7,.85),teeth:0,tooth:0},hazel:{ratio:e.range(.4,.46),lobes:0,amp:0,widest:e.range(.85,1.05),teeth:e.range(9,12),tooth:e.range(.05,.09)}}[t],u=Xp(e,s,c,0,i,Math.min(i*l.ratio,xm*r/(1+l.amp)),l.lobes,l.amp,1);u.widest=l.widest,u.teeth=l.teeth,u.toothAmp=l.tooth,u.petiole=.08999999999999997*r,t===`hazel`&&(u.shade=Math.min(u.shade*1.1,1)),n.push(u)}return sm(n,[])}var Cm=Math.PI*2;function wm(e,t,n){let r=e.bx-e.ax,i=e.by-e.ay,a=Gp(((t-e.ax)*r+(n-e.ay)*i)/(r*r+i*i+1e-12));return Math.hypot(t-(e.ax+r*a),n-(e.ay+i*a))}var Tm=512;function Em(e,t,n=Tm){let r=new Int32Array(n*n).fill(-1);return e.forEach((e,t)=>{let i=Math.max(Math.floor((Math.min(e.ax,e.bx)-e.r)*n),0),a=Math.min(Math.ceil((Math.max(e.ax,e.bx)+e.r)*n),n-1),o=Math.max(Math.floor((Math.min(e.ay,e.by)-e.r)*n),0),s=Math.min(Math.ceil((Math.max(e.ay,e.by)+e.r)*n),n-1);for(let c=o;c<=s;c++)for(let o=i;o<=a;o++)wm(e,(o+.5)/n,(c+.5)/n)<e.r&&(r[c*n+o]=t)}),(i,a,o)=>{let s=r[Math.min(Math.max(Math.floor(a*n),0),n-1)*n+Math.min(Math.max(Math.floor(i*n),0),n-1)];if(s<0)return t?t(i,a,o):!1;let c=e[s];return o.shade=c.shade,o.hue=c.hue,o.thin=.55,o.tu=c.tu,o.tv=c.tv,o.open=c.open,!0}}var Dm=.38,Om=.85,km=.15,Am=.0013,jm=.0013,Mm=.02,Nm=8;function Pm(e,t,n,r,i,a,o,s,c){let l=i<0?-1:1,u=Math.max(8,Math.round(a/jm)),d=n,f=r,p=d,m=f;for(let n=1;n<=u;n++){let r=n/u,h=i+l*c*(r-1.6*r*r);if(d+=Math.sin(h)*a/u,f-=Math.cos(h)*.9*a/u,(n%6==0||n===u)&&(t.push({ax:p,ay:m,bx:d,by:f,r:.0011,shade:.45,hue:km,open:s,tu:0,tv:0}),p=d,m=f),r<.04)continue;let g=o*(.65+.35*Math.sin(Math.PI*Math.min(r*.9+.1,1)))*e.range(.8,1.2),_=Gp((r-.72)/.28),v=e.next()<.5?Nm:7;for(let n=0;n<v;n++){let i=n%2==0?-1:1,a=h+(n>=2?e.range(-1,1):i*e.range(.4,1.2));t.push({ax:d,ay:f,bx:d+Math.sin(a)*g,by:f-Math.cos(a)*g*.9,r:Am,shade:(.5+.45*e.next())*(.85+.25*_),hue:_>.4&&e.next()<.5?.3+.12*e.next():.05*e.next(),open:s*(.75+.25*r),tu:i*.4+e.range(-.15,.15),tv:e.range(-.3,.3)})}}return[d,f]}function Fm(e,t=512){let n=[],r={leader:[],shoots:[]},i=e=>[.5+.03*Math.sin(e*2.6),.97-.85*e];for(let e=0;e<14;e++){let[t,a]=i(e/14),[o,s]=i((e+1)/14);n.push({ax:t,ay:a,bx:o,by:s,r:.0026,shade:Dm,hue:Om,open:.8,tu:0,tv:0}),r.leader.push([t,a])}r.leader.push(i(1));for(let t=0;t<17;t++){let a=Math.min(.03+.9*((t+e.range(-.3,.3))/16),.93),[o,s]=i(a);for(let t of[-1,1]){if(e.next()<.1)continue;let i=.4*(1-.6*a)*e.range(.65,1.12),c=t*(1.1-.35*a+e.range(-.18,.18)),[l,u]=Pm(e,n,o,s,c,i,.0135,.8,e.range(.15,.5));r.shoots.push({ax:o,ay:s,bx:l,by:u});let d=Math.round(i/Mm);for(let t=0;t<d;t++){if(e.next()<.12)continue;let r=.12+.82*((t+e.range(-.3,.3))/Math.max(d-1,1)),a=t%2==0?1:-1;Pm(e,n,o+(l-o)*r,s+(u-s)*r,c+a*e.range(.7,1.1),.2*i*(1-.65*r)*e.range(.7,1.25),.0105,.6,e.range(.1,.4))}}}let[a,o]=i(1);return Pm(e,n,a,o+.02,0,.07,.011,1,0),Object.assign(Em(n,null,t),{spray:r})}function Im(e,t=512,n=!1){let r=[],i=n?1.9:1,a=(t,n,o,s,c,l)=>{let u=t,d=n,f=Math.max(8,Math.round(s/.0028));for(let p=1;p<=f;p++){let m=p/f,h=o+c*m;if(t+=Math.sin(h)*s/f,n-=Math.cos(h)*s/f,(p%5==0||p===f)&&(r.push({ax:u,ay:d,bx:t,by:n,r:.0024*(1-.5*m),shade:Dm,hue:Om,open:.6,tu:0,tv:0}),u=t,d=n),l===0&&p===Math.round(f*e.range(.45,.6)))for(let r of[-1,1])a(t,n,h+r*e.range(.5,.85),s*e.range(.4,.55),-r*e.range(0,.3),1);if(m<.3)continue;let g=Math.sin(Math.PI*Math.min((m-.3)/.75,1));for(let a=0;a<4;a++){let o=a%2==0?-1:1,s=h+o*e.range(a<2?.35:.1,1.05),c=(.024+.018*g)*e.range(.8,1.15)*i,u=m<.5&&e.next()<.07;r.push({ax:t,ay:n,bx:t+Math.sin(s)*c,by:n-Math.cos(s)*c,r:Am,shade:(.55+.4*e.next())*(.8+.25*m),hue:u?.7+.2*e.next():m>.85&&e.next()<.4?.25+.1*e.next():.06*e.next(),open:(.55+.45*m)*(l===0?1:.9),tu:o*.45+e.range(-.2,.2),tv:e.range(-.3,.3)})}}};if(n)a(.5,.955,e.range(-.05,.05),.86,e.range(-.1,.1),0);else{let t=e.int(3,4);for(let n=0;n<t;n++){let r=-.6+1.2*((n+e.range(-.2,.2))/(t-1));a(.5,.955,r,e.range(.7,.85)*(1-.25*Math.abs(r)),e.range(-.2,.2),0)}}let o=(e,t)=>e>.01&&e<.99&&t>.01&&t<.99;return Em(r.filter(e=>o(e.ax,e.ay)&&o(e.bx,e.by)),null,t)}function Lm(e,t=512){let n=[],r=e.range(-.08,.08),[i,a]=Pm(e,n,.5,.97,r,.9,.05,.6,e.range(0,.15)),o=e.int(8,11);for(let t=0;t<o;t++){let s=.08+.8*(t+e.range(-.3,.3))/o;Pm(e,n,.5+(i-.5)*s,.97+(a-.97)*s,r+(t%2==0?1:-1)*e.range(.55,1),e.range(.2,.32)*(1-.45*s),.038,.8,e.range(.1,.35))}let s=(e,t)=>e>.01&&e<.99&&t>.01&&t<.99;return Em(n.filter(e=>s(e.ax,e.ay)&&s(e.bx,e.by)),null,t)}function Rm(e,t,n){let r=e.bx-e.ax,i=e.by-e.ay,a=Gp(((t-e.ax)*r+(n-e.ay)*i)/(r*r+i*i+1e-12)),o=e.r0+(e.r1-e.r0)*a;return Math.hypot(t-(e.ax+r*a),n-(e.ay+i*a))/o<1?a:-1}function zm(e){let t=new ue(e),n=[];for(let e=0;e<24;e++){let r=(e+t.range(.15,.85))/24,i=.045+.865*r**.95,a=.05+.43*r**.85;for(let o=0;o<13;o++){let s=o/13*Cm+e*1.9+t.range(-.25,.25),c=Math.sin(s),l=a*Math.abs(c)*t.range(.6,1.08),u=(.016+.085*r)*(.35+Math.abs(c))*t.range(.7,1.3);n.push({ax:.5,ay:i,bx:.5+Math.sign(c)*l,by:i+u,r0:.02+.026*r,r1:.011+.012*r,shade:.55+.4*t.next(),hue:t.next()<.3?.3+.1*t.next():.06*t.next()})}}n.push({ax:.5,ay:.18,bx:.5,by:.025,r0:.014,r1:.003,shade:.8,hue:.32});let r=new qp(20);for(let e of n){let t=e.r0+.004;r.add(e,Math.min(e.ax,e.bx)-t,Math.min(e.ay,e.by)-t,Math.max(e.ax,e.bx)+t,Math.max(e.ay,e.by)+t)}return(t,n,i)=>{if(n>.93)return n<.985&&Math.abs(t-.5)<.02&&(i.shade=.28,i.hue=0,i.thin=0,i.tu=0,i.tv=0,i.open=.4,!0);let a=r.at(t,n);for(let r=a.length-1;r>=0;r--){let o=a[r],s=Rm(o,t,n);if(s<0)continue;let c=Gp(s),l=J(Math.floor(t*230),Math.floor(n*230),e);if(c>.55&&l<(c-.55)*1.1)continue;let u=Math.sign(o.bx-o.ax),d=Math.sign(n-(o.ay+(o.by-o.ay)*c));return i.shade=Math.min(o.shade*(.62+.5*c)*(.85+.3*l),1),i.hue=c>.8?Math.max(o.hue,.28):o.hue,i.thin=.5,i.tu=u*.45*c,i.tv=.2*d,i.open=.22+.78*c,!0}return!1}}var Bm=1024,Vm=e=>Math.round(Math.log2(e/4))+1,Z={sprig:0,needles:1,blob:2,conifer:3,birch:4,shrub:5,oak2:6,birch2:7,pine:8,beech:9,beech2:10,hawthorn:11,brush:12,brush2:13,pine2:14,needles2:15,oakSheet:16,birchSheet:17,beechSheet:18,hazelSheet:19},Hm=1,Um=128;function Wm(e){let t=e%4,n=Math.floor(e/4);return[t/4,n/5,(t+1)/4,(n+1)/5]}var Gm=[[0,.9,.9,1],[.35,1.55,1.1,.75],[.7,2.3,1,.6],[1,2.4,.78,.9]];function Km(e,t,n){let r=0;for(;r<Gm.length-2&&e>Gm[r+1][0];)r++;let i=Gm[r],a=Gm[r+1],o=Gp((e-i[0])/(a[0]-i[0])),s=1-.3*Gp((e-.8)/.2);for(let e=0;e<3;e++)n[e]=(i[e+1]+(a[e+1]-i[e+1])*o)*t*s}var qm=7,Jm=8,Ym=3,Xm=e=>Math.round(Gp(e)*255);function*Zm(e,t,n,r){let i=r*4,a=t%4*r,o=Math.floor(t/4)*r,s=Kp(),c=[0,0,0],l=new Float64Array(qm),u=new Float64Array(qm),d=0,f=new Float32Array(r*r*Jm);for(let t=0;t<r;t++){for(let n=0;n<r;n++){l.fill(0);let i=0;for(let a=0;a<Hm;a++)for(let o=0;o<Hm;o++)e((n+(o+.5)/Hm)/r,(t+(a+.5)/Hm)/r,s)&&(Km(s.hue,s.shade,c),i++,l[0]+=c[0],l[1]+=c[1],l[2]+=c[2],l[3]+=s.tu,l[4]+=s.tv,l[5]+=s.thin,l[6]+=s.open);let a=(t*r+n)*Jm;if(f[a]=i/1,i!==0){d++;for(let e=0;e<qm;e++)f[a+1+e]=l[e]/i,u[e]+=f[a+1+e]}}(t&Ym)===Ym&&(yield)}let p=Array.from(u,e=>d>0?e/d:0);d===0&&(p[0]=p[1]=p[2]=.7,p[5]=1,p[6]=1);for(let e=0;e<r;e++){for(let t=0;t<r;t++){let s=(e*r+t)*Jm,c=f[s],l=e=>c>0?f[s+1+e]:p[e],u=((o+e)*i+a+t)*4;n.colour[u]=Xm(l(0)/3),n.colour[u+1]=Xm(l(1)/3),n.colour[u+2]=Xm(l(2)/3),n.colour[u+3]=Math.round(c*255),n.data[u]=Xm(.5+.5*l(3)),n.data[u+1]=Xm(.5+.5*l(4)),n.data[u+2]=Xm(l(5)),n.data[u+3]=Xm(l(6))}(e&Ym)===Ym&&(yield)}}function Qm(e,t,n,r,i=1){let a=t/4,o=n/5,s=r%4*a,c=Math.floor(r/4)*o,l=0;for(let n=0;n<o;n++)for(let r=0;r<a;r++)e[((c+n)*t+s+r)*4+3]*i>=Um&&l++;return l/(a*o)}function*$m(e,t,n,r){let i=t>>1,a=n>>1,o={colour:new Uint8Array(i*a*4),data:new Uint8Array(i*a*4)},s=new Float64Array(7);for(let n=0;n<a;n++){for(let r=0;r<i;r++){let a=0,c=0;s.fill(0);for(let i=0;i<4;i++){let o=((2*n+(i>>1))*t+2*r+(i&1))*4,l=e.colour[o+3]+.5;a+=e.colour[o+3],c+=l;for(let t=0;t<3;t++)s[t]+=e.colour[o+t]*l,s[3+t]+=e.data[o+t]*l;s[6]+=e.data[o+3]*l}let l=(n*i+r)*4;for(let e=0;e<3;e++)o.colour[l+e]=Math.round(s[e]/c),o.data[l+e]=Math.round(s[3+e]/c);o.data[l+3]=Math.round(s[6]/c),o.colour[l+3]=Math.round(a/4)}(n&15)==15&&(yield)}for(let e=0;e<20;e++){let t=1,n=8;for(let s=0;s<14;s++){let s=.5*(t+n);Qm(o.colour,i,a,e,s)<r[e]?t=s:n=s,yield}let s=i/4,c=a/5,l=e%4*s,u=Math.floor(e/4)*c;for(let e=0;e<c;e++)for(let t=0;t<s;t++){let r=((u+e)*i+l+t)*4+3;o.colour[r]=Math.min(255,Math.round(o.colour[r]*n))}}return o}function eh(e){return Array.from({length:20},(t,n)=>th(n,e))}function th(e,t){let n=e=>new ue(7855+e*7919);return[()=>fm(n(0)),()=>Fm(n(1),t),()=>mm(n(2)),()=>zm(23),()=>pm(n(4)),()=>hm(n(5)),()=>fm(n(6)),()=>pm(n(7)),()=>Im(n(8),t),()=>gm(n(9)),()=>gm(n(10)),()=>_m(n(11)),()=>Lm(n(12),t),()=>Lm(n(13),t),()=>Im(n(14),t,!0),()=>Fm(n(15),t),()=>Sm(n(16),`oak`),()=>Sm(n(17),`birch`),()=>Sm(n(18),`beech`),()=>Sm(n(19),`hazel`)][e]()}var nh=new Set([Z.sprig,Z.oak2,Z.birch,Z.birch2,Z.beech,Z.beech2,Z.shrub,Z.hawthorn]),rh=new Map;function ih(e){return rh.has(e)||rh.set(e,nh.has(e)?th(e,512).layout??null:null),rh.get(e)??null}var ah=new Map,oh=128;function sh(e,t=0){let n=`${e}:${t}`,r=ah.get(n);if(!r){let i=th(e,512),a=Kp(),[o,s,c,l]=Wm(e),u=oh,d=new Uint8Array(16384);for(let e=0;e<u;e++)for(let t=0;t<u;t++)d[e*u+t]=+!!i((t+.5)/u,(e+.5)/u,a);for(let[e,n]of[[1,0],[0,1]]){if(t<=0)break;let r=new Uint8Array(16384);for(let i=0;i<u;i++)for(let a=0;a<u;a++)for(let o=-t;o<=t&&!r[i*u+a];o++){let t=a+o*e,s=i+o*n;t>=0&&t<u&&s>=0&&s<u&&d[s*u+t]&&(r[i*u+a]=1)}d=r}let f=e=>Math.min(127,Math.max(0,Math.floor(e*u))),p=d;r=(e,t)=>p[f((t-s)/(l-s))*u+f((e-o)/(c-o))]===1,ah.set(n,r)}return r}var ch=new Map;function lh(e){return ch.has(e)||ch.set(e,Fm(new ue(7855+e*7919),64).spray),ch.get(e)}function uh(e){return e===Z.sprig||e===Z.oak2||e===Z.hawthorn?Z.oakSheet:e===Z.birch||e===Z.birch2?Z.birchSheet:e===Z.beech||e===Z.beech2?Z.beechSheet:e===Z.shrub?Z.hazelSheet:null}function*dh(e){let t=e*4,n=e*5,r={colour:new Uint8Array(t*n*4),data:new Uint8Array(t*n*4)},i=eh(e);for(let t=0;t<i.length;t++)yield*Zm(i[t],t,r,e);let a=Array.from({length:20},(e,i)=>Qm(r.colour,t,n,i)),o=[r],s=t,c=n;for(let t=1;t<Vm(e);t++)o.push(yield*$m(o[t-1],s,c,a)),s>>=1,c>>=1;return{tileSize:e,colour:o.map(e=>e.colour),data:o.map(e=>e.data)}}function fh(e=8,t,n=512){return yp(dh(n),e,t)}var ph=Math.PI*2,mh=[0,1,0],hh=(e,t,n)=>e+(t-e)*n,gh=-.8,_h=1.3;function vh(e,t){let n=Math.cos(t);return[n*Math.sin(e),Math.sin(t),n*Math.cos(e)]}function yh(e,t,n){let r=Math.cos(n),i=Math.sin(n),a=zf(t,e)*(1-r),o=K(t,e);return[e[0]*r+o[0]*i+t[0]*a,e[1]*r+o[1]*i+t[1]*a,e[2]*r+o[2]*i+t[2]*a]}function bh(e){let t=e.range(-1,1),n=e.range(0,ph),r=Math.sqrt(1-t*t);return[r*Math.cos(n),t,r*Math.sin(n)]}function xh(e,t){let n=Math.min(Math.max(t,0),1)*(e.length-1),r=Math.min(Math.floor(n),e.length-2),i=n-r;return[hh(e[r][0],e[r+1][0],i),hh(e[r][1],e[r+1][1],i),hh(e[r][2],e[r+1][2],i)]}function Sh(e,t){let n=Math.min(Math.floor(Math.min(Math.max(t,0),1)*(e.length-1)),e.length-2);return q(W(e[n+1],e[n]))}function Ch(e,t){let n=e.pts,r=0;for(;r<n.length-2&&n[r+1][1]<t;)r++;let i=Math.min(Math.max((t-n[r][1])/Math.max(n[r+1][1]-n[r][1],1e-6),0),1);return[hh(n[r][0],n[r+1][0],i),t,hh(n[r][2],n[r+1][2],i)]}function wh(e,t){let n=e.pts,r=0;for(;r<n.length-2&&n[r+1][1]<t;)r++;let i=Math.min(Math.max((t-n[r][1])/Math.max(n[r+1][1]-n[r][1],1e-6),0),1);return hh(e.radii[r],e.radii[r+1],i)}function Th(e){if(e.foliage!==H.leaf||e.radial||e.clusters.length===0)return e;let t=.75*e.clusters.reduce((e,t)=>e+t.r,0)/e.clusters.length,n=[];for(let r of e.limbs)if(!(r.dead||r.root||r.order<1))for(let e of r.order===1?[.6,.85]:[.35,.75])n.push({c:xh(r.pts,e),r:r.order===1?1.2*t:t});return{...e,clusters:[...e.clusters,...n]}}function Eh(e,t){let n=[gh,-.15,.08,.3,.6,1];for(let r=1;r<=t;r++)n.push(1+(e-1)*r/t);return n}var Dh=e=>wh(e,_h);function Oh(e,t,n,r,i,a,o,s=1.25){let c=e.range(0,ph),l=e.range(0,100),u=e.range(0,100),d=[],f=[];for(let e of Eh(t,o)){let o=(e-gh)/(t-gh),p=Math.max(e,0)/t,m=i*p*p;d.push([Math.sin(c)*m+a*Math.sin(o*6.1+l),e,Math.cos(c)*m+a*Math.sin(o*5.3+u)]),f.push((r+(n-r)*(1-p)**s)*(1+.35*Math.exp(-Math.max(e,0)/.45)))}return{pts:d,radii:f,order:0}}function kh(e){let t=q(W(e[1],e[0])),n=q(K(t,Math.abs(t[1])<.95?mh:[1,0,0]));return[n,K(t,n)]}function Ah(e,t,n,r){let i=new ue(e),a=i.range(0,ph),o=i.range(.4,1.2)*(i.next()<.5?-1:1),s=wh(t,.3)*1.6+r+i.range(.3,1),c=[Math.sin(a),0,Math.cos(a)],l=[Math.cos(a),0,-Math.sin(a)],u=U(G(c,s),G(l,o)),d=[],f=[],p=i.range(-.25,.25),m=Math.max(4,Math.round(n/.8));for(let e=0;e<=m;e++){let t=e/m,i=r*hh(1,.7,t)*(e===0||e===m?.75:1);d.push(U(U(u,G(c,n*t)),[l[0]*p*Math.sin(t*Math.PI),i*.45,l[2]*p*Math.sin(t*Math.PI)])),f.push(i)}return{pts:d,radii:f,order:1,dead:!0,parent:t}}function jh(e,t,n,r){let[i,a]=kh(t.pts),o=wh(t,.3),s=[];for(let c=0;c<n.count;c++){if(e.next()<.25)continue;let l=(e.range(.75,1.15)-.75)/.4,u=e.range(-1,1),d=(e.range(.42,.55)-.42)/.13,f=ph*(c+.5-n.phase+.3*u)/n.count,p=q([i[0]*Math.cos(f)+a[0]*Math.sin(f),0,i[2]*Math.cos(f)+a[2]*Math.sin(f)]),m=Ch(t,.1),h=Math.min(r,.3+1.5*o)*(.55+.8*l),g=q(K(p,mh)),_=[],v=[],y=o*(.3+.35*d);for(let e=0;e<=6;e++){let t=e/6,n=o*.3+h*t,r=y*hh(1,.18,t**.7),i=r*hh(.3,-.5,t)-r*1.6*Math.max(0,(t-.45)/.55)**1.5;_.push(U(U([m[0],i,m[2]],G(p,n)),G(g,.1*u*h*Math.sin(t*3)))),v.push(r)}s.push({pts:_,radii:v,order:1,root:!0,parent:t})}return s}function Mh(e,t,n,r,i,a,o){let s=[t],c=q(n),l=t;for(let t=1;t<=i;t++){let n=t/i;c=q(U(U(c,G(mh,a(n)/i)),G(bh(e),o/i))),l=U(l,G(c,r/i)),s.push(l)}return s}function Nh(e,t,n,r=1){return Array.from({length:n},(i,a)=>hh(e,t,(a/(n-1))**r))}function Ph(e,t){let n=1/0,r=1/0,i=1/0,a=-1/0,o=-1/0,s=-1/0;for(let t of e)n=Math.min(n,t[0]),a=Math.max(a,t[0]),r=Math.min(r,t[1]),o=Math.max(o,t[1]),i=Math.min(i,t[2]),s=Math.max(s,t[2]);return{c:[(n+a)/2,(r+o)/2,(i+s)/2],r:[(a-n)/2+t,(o-r)/2+t,(s-i)/2+t]}}function Fh(e,t,n,r,i,a,o){let s=[],c=o?Math.max(1,Math.round(i/4)):i;for(let i=0;i<c;i++){let l=hh(n,r,(i+e.range(.2,.8))/c),u=o?e.int(3,5):1,d=e.range(0,ph);for(let i=0;i<u;i++){let o=d+ph*(i+e.range(-.2,.2))/u,c=e.next()<.75,f=a*(c?e.range(.06,.22):e.range(.3,.7))*hh(1.15,.8,(l-n)/Math.max(r-n,.001)),p=vh(o,e.range(-.45,.05)),m=wh(t,l),h=Mh(e,U(Ch(t,l),G([p[0],0,p[2]],m*.6)),p,f,c?1:3,()=>-.3,.5);s.push({pts:h,radii:Nh(Math.min(.012+.02*f,m*.4),c?.009:.003,h.length),order:1,dead:!0,parent:t})}}return s}function Ih(e,t,n){let r=Oh(e,t,.0165*t+.03,.02,n.lean,.05,12),i=[r],a=[],o=n.crownBase*t,s=.985*t-o,c=o,l=0;for(;c<.985*t;){let u=(c-o)/s,d=u<.45?7:u<.8?6:5,f=Math.max(.55,n.reach*t*(1-u)**.85),p=e.range(0,ph);for(let t=0;t<d;t++){let o=c+e.range(-.1,.1),s=vh(p+(t+e.range(-.2,.2))*ph/d,hh(-.12,.75,u*u)),m=U(Ch(r,o),G([s[0],0,s[2]],wh(r,o)*.5)),h=f*e.range(.85,1.12),g=Mh(e,m,s,h,8,e=>-.75*(1-u)*(1-e)+1.1*e*e*(.5+u),.2),_=.012+.014*h;i.push({pts:g,radii:Nh(_,.005,9),order:1,parent:r});for(let e of[.42,.72,.97]){let t=q(U(Sh(g,e),[0,-(n.droop*(1-u)*(1-e*.6)),0])),r=Math.max(.7,h*.46);a.push({c:U(xh(g,e),G(t,r*.15)),t,len:r,width:r*.95,branch:l})}l++}c+=.8*hh(1,.42,u)}for(let n=0;n<4;n++){let i=n/4*ph+e.range(0,.6),o=q(U(G(mh,3),vh(i,.2)));a.push({c:U(Ch(r,t-.45),G(o,.5)),t:o,len:1.4,width:1.1,branch:l})}n.deadBelow&&i.push(...Fh(e,r,1.2,o-.3,Math.round((o-1.5)/1.1)*2,n.reach*t*.55,!0));let u={count:e.int(5,7),amp:.55,height:.5,phase:e.next()};i.push(...jh(e,r,u,.4+2.2*r.radii[2])),n.droop>=1&&i.push(Ah(Math.round(t*997)+3,r,.4*t,.009*t+.02));let d=n.reach*t*1.05;return{species:`spruce`,height:t,crownC:[0,(o+t)/2+.03*t,0],crownR:[d,(t-o)/2+.03*t,d],trunkRadius:Dh(r),bark:H.spruceBark,limbs:i,fronds:a,clusters:[],cardsPerCluster:0,cardSize:0,radial:!1,foliage:H.needle,trunkSides:[14,6,4],flare:u,gnarl:.025}}function Lh(e,t,n,r,i,a){let o=e.int(2,4),s=hh(.6,.45,r);for(let r=0;r<o;r++){let c=hh(.3,.88,(r+e.range(.15,.85))/o),l=xh(t.pts,c),u=Sh(t.pts,c),d=q(K(u,mh)),f=r%2==0?1:-1,p=q(U(U(u,G(d,f*e.range(.6,1.1))),[0,e.range(.25,.6),0])),m=Math.min(1.8,Math.max(.6,n*e.range(.25,.42))),h=Mh(e,l,p,m,3,()=>.35,.25),g={pts:h,radii:Nh(.012+.008*m,.006,h.length),order:2,parent:t};if(i.push(g),a.push({c:U(h[h.length-1],[0,.1,0]),r:s}),a.push({c:U(xh(h,.55),[0,.08,0]),r:s*.85}),e.next()<.5){let t=Mh(e,xh(h,.7),q(U(Sh(h,.7),G(d,-f*.8))),m*.45,2,()=>.3,.2);i.push({pts:t,radii:Nh(.008,.005,t.length),order:3,parent:g}),a.push({c:U(t[t.length-1],[0,.08,0]),r:s*.8}),a.push({c:U(t[0],[0,.06,0]),r:s*.7})}}}function Rh(e,t,n){let r=Oh(e,t,.0155*t+.04,.02,n.lean,n.wobble,14,1.1),i=[r],a=[],o=n.limbs;for(let s=0;s<o;s++){let c=s/(o-1),l=t*hh(n.crownStart,.96,c)+e.range(-.3,.3),u=Math.max(1.4,hh(4.6,1.6,c)*n.spread*e.range(.8,1.2)),d=vh(e.range(0,ph),hh(.05,.6,c)),f=Mh(e,Ch(r,l),d,u,6,e=>.35+.5*e-.6*(1-c),.45+.3*n.wobble),p={pts:f,radii:Nh(.03+.012*u,.01,7),order:1,parent:r};i.push(p);for(let e of[.55,.7,.85,1])a.push({c:U(xh(f,e),[0,.12,0]),r:hh(.65,.5,c)});Lh(new ue(Math.round(t*977)+31*s+11),p,u,c,i,a)}a.push({c:U(Ch(r,t),[0,.3,0]),r:.9}),n.stubs>0&&i.push(...Fh(e,r,2,t*n.crownStart-.5,n.stubs,1.6,!1));let s=Ph(a.map(e=>e.c),1),c={count:e.int(5,6),amp:.32,height:.45,phase:e.next()};return i.push(...jh(e,r,c,.3+1.8*r.radii[2])),{species:`pine`,height:t,crownC:s.c,crownR:s.r,trunkRadius:Dh(r),bark:H.pineBark,limbs:i,fronds:[],clusters:a,cardsPerCluster:5,cardSize:1,radial:!0,foliage:H.needle,trunkSides:[14,6,4],flare:c,gnarl:.035}}function zh(e,t){let n={point:[0,0,0],tangent:[0,1,0],radius:.002,distance:1/0,limb:null};for(let r of e)for(let e=1;e<r.pts.length;e++){let i=r.pts[e-1],a=W(r.pts[e],i),o=Math.max(0,Math.min(1,zf(W(t,i),a)/Math.max(zf(a,a),1e-12))),s=U(i,G(a,o)),c=Math.hypot(...W(t,s));c<n.distance&&(n={point:s,tangent:q(a),radius:r.radii[e-1]+(r.radii[e]-r.radii[e-1])*o,distance:c,limb:r})}return n}var Bh=Math.PI*2,Vh=[0,1,0],Hh=(e,t,n)=>e+(t-e)*n,Uh=[[1,1,1],[1,-1,-1],[-1,1,-1],[-1,-1,1]].map(q),Wh=.95;function Gh(e){let t=[...e.clusters.map(e=>[e.c[0],e.c[1],e.c[2],e.r*e.r]),...e.fronds.map(e=>[e.c[0],e.c[1],e.c[2],.25*e.len*e.width])],n=new Map;return e=>{let r=Math.round(e[0]/Jh),i=Math.round(e[1]/Jh),a=Math.round(e[2]/Jh),o=((r+512)*1024+(i+512))*1024+(a+512),s=n.get(o);if(s!==void 0)return s;let c=r*Jh,l=i*Jh,u=a*Jh,d=0;for(let[e,n,r,i]of t){let t=n-l;t<.3||Math.hypot(e-c,r-u)>.9*t+1||(d+=i/(1+.15*t*t))}let f=1/(1+Kh*d);return n.set(o,f),f}}var Kh=.3,qh=.3,Jh=.25;function Yh(e){let[t,n,r]=e.crownC,[i,a,o]=e.crownR,s=e.foliage===H.needle,c=e.height,l=Gh(e);return{normalAt:s?e=>{let n=e[0]-t,i=e[2]-r,a=Math.hypot(n,i);return a>1e-4?q([n/a,.6,i/a]):Vh}:e=>{let s=q([(e[0]-t)/(i*i),(e[1]-n)/(a*a),(e[2]-r)/(o*o)]);return q([s[0],s[1]+.25,s[2]])},aoAt:e=>1-qh*(1-(.38+.62*Y(.2,1,Math.hypot((e[0]-t)/i,(e[1]-n)/a,(e[2]-r)/o)))*(.7+.3*Y(-.9,.6,(e[1]-n)/a))*l(e)),swayAt:e=>Math.min((Math.max(e,0)/c)**1.6,1)}}function Xh(e,t,n,r,i=!1){let[a,o,s,c]=Wm(t);return{rect:i?[s,o,a,c]:[a,o,s,c],kind:n,normalAt:e.normalAt,aoAt:e.aoAt,swayAt:t=>e.swayAt(t[1]),phase:r}}function Zh(e,t){let n=t.next()<.5;return e.species===`bush`?n?Z.hawthorn:Z.shrub:e.species===`birch`?n?Z.birch2:Z.birch:e.species===`beech`?n?Z.beech2:Z.beech:n?Z.oak2:Z.sprig}var Qh=.15,$h=.045,eg=128,tg=9;function ng(e,t,n){let r=[e.pts[0]],i=[e.radii[0]];for(let a=1;a<e.pts.length;a++){let o=e.pts[a-1],s=e.pts[a],c=Math.min(o[1],s[1])<n?Math.max(1,Math.ceil(Bf(W(s,o))/t)):1;for(let t=1;t<=c;t++){let n=t/c;r.push([o[0]+(s[0]-o[0])*n,o[1]+(s[1]-o[1])*n,o[2]+(s[2]-o[2])*n]),i.push(e.radii[a-1]+(e.radii[a]-e.radii[a-1])*n)}}return{pts:r,radii:i,order:e.order}}function rg(e,t){if(t===1)return e;let n=e.pts.length,r=[],i=[];for(let a=0;a<n;a+=t)r.push(e.pts[a]),i.push(e.radii[a]);return(n-1)%t!=0&&(r.push(e.pts[n-1]),i.push(e.radii[n-1])),{pts:r,radii:i,order:e.order}}var ig=e=>e>.06?6:e>.035?5:e>.018?4:3;function ag(e,t,n,r,i=!1){let a=t.limbs.length>100&&t.foliage!==H.leaf,o=new Set(t.limbs.map(e=>e.parent)),s=[];return t.limbs.forEach((c,l)=>{let u=t.trunkSides[r],d=1;if(c.order>0){if(r===1&&(c.order>1||a||c.root||c.dead))return;u=r===0?c.root&&c.radii[0]>.06?8:Math.min(ig(c.radii[0]),a&&c.order>1?4:c.root?5:6):3,d=r===1||!o.has(c)&&(c.order>=3||a&&c.order===1)?2:1}let f=rg(c,d);c.dead||s.push(f);let p=c.order===0,m=t.gnarl??0,h=i&&r===0&&!c.root&&(p||c.radii[0]>Qh)&&c.pts[0][1]<tg,g=h?ng(f,$h,tg):f;h&&(u=Math.max(u,Math.min(eg,Math.round(Bh*Math.max(...f.radii)*(p&&t.flare?1+t.flare.amp:1)/$h)))),Yf(e,g.pts,g.radii,{sides:u,kind:c.dead?H.deadWood:t.bark,sway:e=>n.swayAt(e),ao:n.aoAt,v0:l*7.31%20,buttress:p?t.flare:void 0,gnarl:m>0&&(p||c.radii[0]>.08)?{amp:m*(p?1:.6),seed:(l*.618034+.13)%1}:void 0})}),s}function og(e,t,n,r,i,a,o,s=!1){let c=n.fronds.length,l=i===0?1:c>60?3:2,u=i===0?1:l===3?1.9:1.4;for(let d=0;d<c;d++){if(l>1&&d%l!==1&&!(c>60&&d>=c-4))continue;let f=n.fronds[d],p=q(K(f.t,Math.abs(f.t[1])<.95?Vh:[1,0,0])),m=t.next()<.5?Z.needles2:Z.needles,h=Xh(r,m,H.needle,t.next()),g=s&&i===0&&n.species===`spruce`&&gg(n,f.c)>Lg;if(g){let i=G(f.t,f.len*.5),o=zh(a,W(f.c,G(i,.94))),s=G(p,f.width*.5),c=r_(o.point,s,i,.97,h,m);c.spread=Vg*f.len;let l=Zg(c,Xg(o.point,[f.t,p],.2,Vh,.04));if(l){let a=Hg(h,m);for(let e of[o.point,U(o.point,s),U(o.point,i)])Ug(a,e,Vh,0,0,0,0);let[c,u,d]=l.move(a).pos;Cg=l.piece,lg(e,t,r,h,c,W(u,c),W(d,c),lh(m),n.bark)}}let _=n.species===`juniper`,v=wg++;if(i===0&&!g&&!_){let t=G(f.t,f.len*.5),[n,r,i,s]=h.rect;for(let c=-Ig;c<Fg;c++){let l=-.84+1.84*c/Fg,u=G(t,1/Fg),d=-.84+1.84*(Math.max(c,0)+1)/Fg,g=r+(s-r)*.92*Math.max(0,1-(d+.84)/1.84),_=r+(s-r)*.92*Math.min(1,1-(d-1.84/Fg+.84)/1.84),y=zh(a,U(f.c,G(t,l))),b=(n+i)/2;for(let t of[1,-1]){let r={...h,rect:[t>0?b:n,g,t>0?i:b,g+(_-g)/.92]},a=G(yh(p,f.t,t*Rg+(c%2==0?.15:-.15)),f.width*.4),s=r_(y.point,a,u,.97,r,m,v),l=s.pos.length-1;for(let e=0;e<l;e++)s.pos[e]=U(s.pos[e],G(a,t));let d=qg(e,s,y.point,[f.t,p],.2,Vh,.04);d&&o?.foliage.push(Jg(d,y.limb))}}}for(let t of g||i===0&&!_?[]:_?[0]:[1,-1]){let n=G(_?q(K(p,f.t)):yh(p,f.t,t*.6),f.width*(_?.45:.5)*u),r=G(f.t,f.len*.5*u);if(i===0){let t=zh(a,W(f.c,G(r,.94))),i=_?yg(U(t.point,G(r,.5)),G(n,1.2),G(r,Bg),.97,h,vg,2,m):r_(t.point,n,r,.97,h,m,v);if(_){let e=q([f.t[0],0,f.t[2]]),n=i.pos.length-1,r=1/0;for(let t=0;t<n;t++)r=Math.min(r,a_(i.pos[t],e));let a=G(e,Math.max(0,zg-r));for(let e=0;e<n;e++)i.pos[e]=U(i.pos[e],a);i.pos[n]=t.point,e_(i,h,m)}let s=qg(e,i,t.point,[f.t,p],.2,Vh,.04);s&&o?.foliage.push(Jg(s,t.limb))}else Xf(e,f.c,n,r,h)}if(n.species===`spruce`){let n=i===0?s?g?5:6:1:s?2:0;for(let c=0;c<n;c++)cg(e,t,r,f,p,(c+t.range(.15,.85))/n,c%2==0?1:-1,i===0&&s,u,s?4:3,i===0?a:[],o)}if(i===0){for(let i=0;i<(n.species===`spruce`||_?0:s?2:1);i++){let n=W(f.c,G(f.t,f.len*t.range(.05,.3))),i=q(U(G(f.t,t.range(.25,.6)),[0,-1,0])),s=G(q(U(p,G(q(K(i,p)),t.range(-.4,.4)))),f.width*t.range(.28,.36)),c=G(i,f.len*t.range(.24,.34)),l=zh(a,n),u=qg(e,r_(l.point,s,c,.97,Xh(r,Z.needles,H.needle,t.next(),t.next()<.5),Z.needles),l.point,[i],.3);u&&o?.foliage.push(Jg(u,l.limb))}if(s&&!g){let n=zh(a,W(f.c,G(f.t,f.len*.47))),i=qg(e,r_(n.point,G(p,f.width*.45),G(f.t,f.len*.48),.97,Xh(r,Z.needles,H.needle,t.next(),!0),Z.needles,v),n.point,[f.t],.25);i&&o?.foliage.push(Jg(i,n.limb))}}}}function sg(e,t,n,r,i){let[a,o,s,c]=n.rect,l=e.length,u=Hg(n,r,i);for(let r=0;r<l;r++){let i=r/(l-1),d=Hh(o+(c-o)*.97,o+(c-o)*.02,i);for(let[o,c]of[[-1,a],[1,s]]){let a=U(e[r],G(t[r],o));Ug(u,a,n.normalAt(a),c,d,n.aoAt(a),n.swayAt(a)*i)}}for(let e=0;e<l-1;e++){let t=2*e;u.tris.push([t,t+1,t+3],[t,t+3,t+2])}let d=Ug(u,e[0],n.normalAt(e[0]),(a+s)/2,o+(c-o)*.97,n.aoAt(e[0]),0);return u.tris.push([d,0,1]),u}function cg(e,t,n,r,i,a,o,s,c,l,u,d){let f=r.len*c*t.range(.6,.9)*(1-.3*a),p=f*t.range(.17,.22),m=U(U(r.c,G(r.t,r.len*c*(a-.5)*.9)),G(i,o*r.width*c*.08)),h=u.length?zh(u,m):null,g=h?h.point:m,_=q(U(U(G(i,o*t.range(.3,.7)),G(r.t,t.range(.2,.45))),[0,-t.range(.5,.9),0])),v=[g],y=[_];for(let e=0;e<l;e++)g=U(g,G(_,f/l)),_=q(U(_,[0,-.35,0])),v.push(g),y.push(_);let b=t.next()<.5?Z.brush:Z.brush2,x=Xh(n,b,H.needle,t.next(),t.next()<.5),S=t.range(0,Math.PI),C=wg++;for(let t of s?[S,S+Math.PI/2]:[S]){let n=qg(e,sg(v,y.map(e=>G(yh(q(K(e,i)),e,t),p)),x,b,C),v[0],[Vh,i],.3,i,.04);h&&n&&d?.foliage.push(Jg(n,h.limb))}}function lg(e,t,n,r,i,a,o,s,c){let l=U(i,G(o,.94)),u=q(K(a,o)),d=i_(a),f=(e,t)=>U(l,U(G(a,(e-.5)*2),G(o,1-2*t)));Yf(e,[0,5,10,s.leader.length-1].map(e=>f(...s.leader[e])),[.006*d*2,.005*d*2,.004*d*2,.0025*d*2],{sides:3,kind:c,sway:e=>n.swayAt(e),ao:e=>r.aoAt(e)});let p=bg;p&&(bg=new Up,Sg=p);for(let r of s.shoots){let i=f(r.ax,r.ay),a=f(r.bx,r.by),o=i_(W(a,i)),s=o*t.range(.15,.4),c=[i,U(U(i,G(W(a,i),.5)),[0,-.35*s,0]),U(a,[0,-s,0])],l=c.map((e,t)=>q(W(c[Math.min(t+1,2)],c[Math.max(t-1,0)]))),d=t.next()<.5?Z.brush:Z.brush2,p=Xh(n,d,H.needle,t.next(),t.next()<.5),m=o*t.range(.5,.6),h=t.range(-.3,.3),g=wg++;for(let t of[h+.6,h-.6])qg(e,sg(c,l.map(e=>G(yh(q(K(e,u)),e,t),m)),p,d,g),i,[u,l[0]],.25)}bg=p,Sg=Cg=null}function ug(e,t,n,r,i){let a=bh(t),o=q(K(a,bh(t)));Xf(e,U(r.c,G(a,i*.85)),G(o,i*.55),G(a,i),Xh(n,Z.pine,H.needle,t.next(),t.next()<.5))}function dg(e,t,n,r,i,a,o,s){for(let c=0;c<i;c++){let i=U(r.c,G(bh(t),r.r*t.range(.2,.7))),c=zh(o,i),l=W(i,c.point),u=q(U(i_(l)>.001?q(l):bh(t),[0,.35,0])),d=Math.max(r.r,hg)*t.range(fg[0],fg[1]),f=q(U(u,q(U(u,[0,.3,0])))),p=[c.point,U(c.point,G(f,d))],m=[f,f],h=d*.53,g=Xh(n,Z.pine2,H.needle,t.next(),t.next()<.5),_=t.range(-mg,mg),v=wg++;for(let t of a?[_,_+Math.PI/2]:[_]){let n=qg(e,sg(p,m.map(e=>G(yh(q(K(e,Math.abs(e[1])<.95?Vh:[1,0,0])),e,t),h)),g,Z.pine2,v),c.point,[Vh,u],.3,Vh,.04);n&&s?.foliage.push(Jg(n,c.limb))}}}var fg=[.5,.8],pg=5,mg=.35,hg=.7,gg=(e,t)=>Math.hypot((t[0]-e.crownC[0])/e.crownR[0],(t[1]-e.crownC[1])/e.crownR[1],(t[2]-e.crownC[2])/e.crownR[2]),_g=.95,vg={fold:0,curl:0,twist:0};function yg(e,t,n,r,i,a,o,s){let c=i_(n),l=q(K(t,n)),[u,d,f,p]=i.rect,m=Hg(i,s),h=U(e,G(n,2*r-1)),g=(e,t)=>{let n=(t+.84)/1.84;return c*(a.fold*Math.abs(e)-a.curl*n*n+a.twist*e*n)},_=(e,r)=>U(U(h,U(G(t,e),G(n,r))),G(l,g(e,r))),v=(e,r,o)=>{let s=(r+.84)/1.84,u=q(K(U(t,G(l,c*(a.fold*Math.sign(e)+a.twist*s))),U(n,G(l,c*(-2*a.curl*s+a.twist*e)/1.84)))),d=i.normalAt(o);return q(U(G(d,.5),G(a_(u,d)<0?G(u,-1):u,.5)))},y=(e,t)=>{let n=_(e,t),r=u+(f-u)*(e+1)/2,a=d+(p-d)*.92*(1-(t+.84)/1.84);return Ug(m,n,v(e,t,n),r,a,i.aoAt(n),i.swayAt(n))},b=()=>Ug(m,e,i.normalAt(e),(u+f)/2,d+(p-d)*r,i.aoAt(e),0);if(o===0){let e=[[1,-.84],[1,1],[-1,1],[-1,-.84]].map(([e,t])=>y(e,t)),t=b();for(let n=0;n<3;n++)m.tris.push([t,e[n],e[n+1]]);return m}for(let e=0;e<=o;e++)for(let t of[-1,0,1])y(t,-.84+1.84*e/o);for(let e=0;e<o;e++)for(let t=0;t<2;t++){let n=3*e+t;m.tris.push([n,n+1,n+4],[n,n+4,n+3])}let x=b();return m.tris.push([x,1,0],[x,2,1]),m}var bg=null,xg=null,Sg=null,Cg=null,wg=0,Tg=null,Eg=0,Dg=0,Og=.01,kg=4,Ag=.015,jg=.006,Mg=2,Ng=.035,Pg=.004,Fg=2,Ig=1,Lg=.85,Rg=1.15,zg=.15,Bg=.72,Vg=.15;function Hg(e,t,n=wg++){return{pos:[],nrm:[],uv:[],sway:[],tris:[],ao:[],kind:e.kind,phase:e.phase,opaque:sh(t),group:n,...e.kind===H.needle?{near:sh(t,Mg),room:Eg}:{near:sh(t,kg),room:Og}}}function Ug(e,t,n,r,i,a,o){return e.pos.push(t),e.nrm.push(q(n)),e.uv.push([r,i]),e.ao.push(a),e.sway.push(o),e.pos.length-1}function Wg(e,t,n,r){return{...e,pos:e.pos.map(e=>U(t,yh(W(e,t),n,r))),nrm:e.nrm.map(e=>yh(e,n,r))}}function Gg(e,t,n){return{...e,pos:e.pos.map(e=>U(t,G(W(e,t),n)))}}function Kg(e,t,n){return{...e,pos:e.pos.map(e=>e[0]===n[0]&&e[1]===n[1]&&e[2]===n[2]?e:U(e,t))}}function qg(e,t,n,r,i,a,o=.03,s=[]){let c=Zg(t,Xg(n,r,i,a,o,s));return c&&$g(e,c.piece),c?.piece??null}var Jg=(e,t)=>({point:e.pos[e.pos.length-1],limb:t,span:e.pos.length});function Yg(e,t){let n=W(e.pts[1],e.pts[0]),r=i_(n),i=[];for(let e of[1,-1,2,-2,3,-3]){let a=t+.03*e/r;a>.05&&a<1&&i.push(G(n,a-t))}return i}function Xg(e,t,n,r,i=.03,a=[]){let o=a.map(e=>t=>({...t,pos:t.pos.map(t=>U(t,e))}));if(r)for(let t of[1,-1,2,-2,3,-3])o.push(n=>Kg(n,G(r,t*i),e));for(let r of t)for(let t of[1,-1,2,-2,4,-4])o.push(i=>Wg(i,e,r,t*n));let s=[.75,.55].flatMap(t=>{let n=n=>Gg(n,e,t);return[n,...o.slice(0,6).map(e=>t=>e(n(t)))]});return[e=>e,...o,...s]}function Zg(e,t){if(!bg)return{piece:e,move:t[0]};let n=0,r=bg.place(r=>r<t.length?t[n=r](e):null,Sg??void 0,Cg??void 0);return r?{piece:n===0?r:Qg(r,e),move:t[n]}:null}function Qg(e,t){if(!Tg)return e;let n=Tg;return{...e,sway:e.sway.map((r,i)=>{let a=n(t.pos[i][1]);return a>1e-6?Math.min(1,r*n(e.pos[i][1])/a):r})}}function $g(e,t){xg?.push(t);let n=(t.phase%1+1)%1,r=e.vertexCount;for(let r=0;r<t.pos.length;r++)e.vertex({p:t.pos[r],n:t.nrm[r],u:t.uv[r][0],v:t.uv[r][1],ao:t.ao[r],sway:t.sway[r],kind:t.kind,phase:n});for(let[n,i,a]of t.tris)e.tri(r+n,r+i,r+a);return t.pos.length}function e_(e,t,n){let r=e.pos[1],i=e.pos[7],a=W(i,r),o=i_(a),s=W(e.pos[2],e.pos[0]),c=q(K(s,a)),l=q(s),u=i_(s),d=e.pos.length-1,f={pos:e.pos[d],nrm:e.nrm[d],uv:e.uv[d],ao:e.ao[d],sway:e.sway[d]};for(let t of[`pos`,`nrm`,`uv`,`ao`,`sway`])e[t].pop();let p=e.tris.filter(e=>e.includes(d)),m=e.tris.filter(e=>!e.includes(d));for(let[i,s]of t_){let d=U(r,G(a,i)),f=q(U(G(q(a),Math.cos(n_)),G(c,s*Math.sin(n_)))),p=r_(d,G(l,u*.22),G(f,o*.22),.97,t,n);p.sway[p.sway.length-1]=t.swayAt(d);let h=e.pos.length;for(let t=0;t<p.pos.length;t++)Ug(e,p.pos[t],p.nrm[t],p.uv[t][0],p.uv[t][1],p.ao[t],p.sway[t]);for(let[e,t,n]of p.tris)m.push([h+e,h+t,h+n])}let h=e.pos.length;e.pos.push(f.pos),e.nrm.push(f.nrm),e.uv.push(f.uv),e.ao.push(f.ao),e.sway.push(f.sway);for(let e of p)m.push(e.map(e=>e===d?h:e));e.tris=m}var t_=[[.45,1],[.6,-1],[.75,1],[.9,-1]],n_=.7;function r_(e,t,n,r,i,a,o){let s=U(e,G(n,2*r-1)),[c,l,u,d]=i.rect,f=Hg(i,a,o),p=[[1,-.84,u,l+(d-l)*.92],[1,1,u,l],[-1,1,c,l],[-1,-.84,c,l+(d-l)*.92]].map(([e,r,a,o])=>{let c=U(s,U(G(t,e),G(n,r)));return Ug(f,c,i.normalAt(c),a,o,i.aoAt(c),i.swayAt(c))}),m=Ug(f,e,i.normalAt(e),(c+u)/2,l+(d-l)*r,i.aoAt(e),0);for(let e=0;e<3;e++)f.tris.push([m,p[e],p[e+1]]);return f}var i_=e=>Math.hypot(e[0],e[1],e[2]),a_=(e,t)=>e[0]*t[0]+e[1]*t[1]+e[2]*t[2];function o_(e,t,n,r,i,a,o,s=!1,c=!1,l=Vh){let u=q(W(i.pts[1],i.pts[0])),d=U(i.pts[0],G(W(i.pts[1],i.pts[0]),a)),f=U(u,G(bh(t),.8)),p=W(f,G(l,a_(f,l)));p=i_(p)<.001?q(K(l,bh(t))):q(p);let m=n.cardSize*t.range(.8,1.25),h=G(p,m),g=G(q(K(p,l)),m),_=vg,v=Zh(n,t),y=Xh(r,v,n.foliage,Dg+t.range(-.015,.015),t.next()<.5),b=y.rect[0]>y.rect[2],x=c&&gg(n,d)>_g,S=x?ih(v):null,C=x?uh(v):null;if(S&&C!==null){let o=yg(d,g,h,.96,y,_,0,v);o.spread=Ng;let s=Zg(o,Xg(d,[l,p],.25,l,.03,Yg(i,a)));if(!s){s_(e,t,n,r,y,d,g,h,_,b,S,C,!0);return}let c=Hg(y,v);for(let e of[d,U(d,g),U(d,h)])Ug(c,e,Vh,0,0,0,0);let[u,f,m]=s.move(c).pos;Cg=s.piece,s_(e,t,n,r,y,u,W(f,u),W(m,u),_,b,S,C);return}let w=qg(e,yg(d,g,h,.96,y,_,0,v),d,[l,p],.25,l,.03,Yg(i,a));w&&o?.foliage.push(Jg(w,i))}function s_(e,t,n,r,i,a,o,s,c,l,u,d,f=!1){let p=i_(s),m=q(K(o,s)),h=U(a,G(s,.92)),g=l?-1:1,_=(e,t)=>{let n=(e-.5)*2*g,r=1-2*t,i=(r+.84)/1.84;return U(U(h,U(G(o,n),G(s,r))),G(m,p*(c.fold*Math.abs(n)-c.curl*i*i+c.twist*n*i)))},[v,y,b,x]=Wm(d),S=(b-v)/4,C=(x-y)/4,w=bg;!f&&w&&(bg=new Up,Sg=w);let T=0;for(let n of u.leaves){let r=_(n.bx-n.dx*n.petiole,n.by-n.dy*n.petiole),a=q(W(_(n.bx+n.dx*n.len,n.by+n.dy*n.len),_(n.bx,n.by))),o=q(U(U(m,G(Vh,.15)),G(bh(t),.2))),s=W(a,G(o,a_(a,o)));s=i_(s)<.001?q(K(o,bh(t))):q(U(q(s),[0,-t.range(0,.35),0]));let c=q(W(o,G(s,a_(o,s)))),l=K(c,s),u=n.len*2*p/(ym-bm),h=(vm-bm)*u,g=xm*u,b=Math.tan(t.range(8,18)*Math.PI/180),x=t.range(.05,.2),w=t.range(-.15,.15),E=t.next()<.5?-1:1,D=t.int(0,15),O=D%4,k=Math.floor(D/4),A=Hg({...i,phase:i.phase+t.range(-.02,.02)},d);A.room=Pg,A.near=sh(d,2);for(let e of[0,1])for(let t of[-1,0,1]){let n=U(U(U(r,G(s,e*h)),G(l,t*g)),G(c,b*Math.abs(t)*g-x*e*e*h+w*t*e*g)),a=q(U(W(c,G(l,b*Math.sign(t)+w*e)),G(s,2*x*e-.5*w*t))),o=i.normalAt(n);Ug(A,n,U(G(o,.5),G(a_(a,o)<0?G(a,-1):a,.5)),v+S*(O+.5+t*xm*E),y+C*(k+vm-e*(vm-bm)),i.aoAt(n),e===0?0:i.swayAt(n)*e)}for(let e=0;e<2;e++)A.tris.push([e,e+1,e+4],[e,e+4,e+3]);if(f){let t=Zg(A,Xg(r,[],0,c,.008).slice(0,5));t&&($g(e,t.piece),T++)}else qg(e,A,r,[c,s],.15,c,.008)&&T++}if(bg=w,Sg=Cg=null,T!==0)for(let t of u.twigs)Yf(e,[_(t.ax,t.ay),_(t.bx,t.by)],[t.r0*2*p,t.r1*2*p],{sides:3,kind:n.bark,sway:e=>r.swayAt(e),ao:e=>i.aoAt(e)})}function c_(e,t,n,r,i,a,o,s=!1){let c=s&&i===0,l=i===1&&!s&&n.midClusters!==void 0?n.clusters.slice(0,n.midClusters):n.clusters;for(let u of l)if(n.radial){if(i===0)dg(e,t,r,u,n.cardsPerCluster*pg,s,a,o);else for(let i=0;i<(s?5:3);i++)ug(e,t,r,u,n.cardSize*u.r*1.3)}else if(i===0){let i=zh(a,u.c),l=Math.max(.03,u.r-n.cardSize*1.25*(Math.hypot(1,1.92)-Math.SQRT2));for(let a=0;a<(s&&!c?2:1);a++){Dg=t.next();let a=q(U(r.normalAt(u.c),G(bh(t),1.5))),d={pts:[i.point,U(u.c,G(a,l))],radii:[Math.min(.007,i.radius*.45),.0015],order:5};Yf(e,d.pts,d.radii,{sides:3,kind:n.bark,sway:e=>r.swayAt(e),ao:r.aoAt}),o?.wood.push(d);let f=q(W(d.pts[1],d.pts[0])),p=q(U(U(G(Vh,.6),r.normalAt(u.c)),G(bh(t),.35)));Math.abs(a_(f,p))<.4&&(p=q(U(p,G(f,(a_(f,p)<0?-1:1)*.6))));for(let i=0;i<n.cardsPerCluster;i++)o_(e,t,n,r,d,.15+.8*(i+.35+.3*t.next())/n.cardsPerCluster,o,s,c,p)}}else{let n=u.r*Wh,i=bh(t),a=t.range(0,Bh),o=Xh(r,Z.blob,H.blob,t.next());for(let r of s?[...Uh,bh(t),bh(t)]:Uh){let s=yh(r,i,a),c=yh(q(K(s,Math.abs(s[1])<.9?Vh:[1,0,0])),s,t.range(0,Bh));Xf(e,u.c,G(c,n),G(K(s,c),n),o)}}}function l_(e,t,n,r,i,a,o){let[s,c,l]=t.crownC,[u,d,f]=t.crownR,p=Math.max(u,f),m=Math.max(c-d,0),h=(c+d-m)/2,g=m+h,_=[Math.cos(r),0,Math.sin(r)],v=[-Math.sin(r),0,Math.cos(r)],[y,b,x,S]=Wm(i),C=e.vertexCount;for(let t=0;t<3;t++)for(let r=0;r<3;r++){let i=r-1,c=t-1,m=[s+_[0]*p*i,g+h*c,l+_[2]*p*i],C=U(m,G(v,f*Math.sqrt(Math.max(1-(p*i/u)**2-(h*c/d)**2,0))));e.vertex({p:m,n:n.normalAt(C),u:Hh(y,x,r/2),v:Hh(S,b,t/2),ao:.72,sway:n.swayAt(m[1]),kind:a,phase:o})}for(let t=0;t<2;t++)for(let n=0;n<2;n++)e.quad(C+t*3+n,C+t*3+n+1,C+(t+1)*3+n+1,C+(t+1)*3+n)}var u_=5;function d_(e,t){let n=e.clusters,[r,,i]=e.crownC,a=n.map((e,t)=>({i:t,key:Math.atan2(e.c[2]-i,e.c[0]-r)+.3*e.c[1]})).sort((e,t)=>e.key-t.key),o=Array.from({length:t},(e,r)=>n[a[Math.floor((r+.5)*n.length/t)].i].c),s=new Int32Array(n.length);for(let e=0;e<12;e++){let e=o.map(()=>[0,0,0,0]);n.forEach((t,n)=>{let r=0,i=1/0;o.forEach((e,n)=>{let a=(t.c[0]-e[0])**2+(t.c[1]-e[1])**2+(t.c[2]-e[2])**2;a<i&&(i=a,r=n)}),s[n]=r;let a=t.r**3,c=e[r];c[0]+=t.c[0]*a,c[1]+=t.c[1]*a,c[2]+=t.c[2]*a,c[3]+=a}),o=o.map((t,n)=>e[n][3]>0?[e[n][0]/e[n][3],e[n][1]/e[n][3],e[n][2]/e[n][3]]:t)}return o.map((e,t)=>{let r=0;return n.forEach((n,i)=>{s[i]===t&&(r=Math.max(r,i_(W(n.c,e))+n.r))}),{c:e,r:Math.max(r,.3)}}).filter((e,t)=>s.includes(t))}function f_(e,t,n,r){let i=n.clusters.length===0&&n.fronds.length===0;if(n.species!==`bush`&&n.species!==`juniper`){let t=n.limbs[0],a=t.pts[0][1],o=i?t.pts[t.pts.length-1][1]:Math.max(.5,Math.min(n.crownC[1]+.3,.6*n.height)),s=[a,.4,o*.5,o];Yf(e,s.map(e=>Ch(t,e)),s.map(e=>wh(t,e)),{sides:n.trunkSides[2],kind:n.bark,sway:e=>r.swayAt(e),ao:()=>1})}if(i)return;let a=n.species===`spruce`;if(!a&&n.foliage===H.leaf&&n.clusters.length>=u_){let i=Math.max(...n.clusters.map(e=>Math.hypot(e.c[0],e.c[2])+e.r*1.05*Math.SQRT2));for(let a of d_(n,u_)){let o=Xh(r,Z.blob,H.blob,t.next());o.aoAt=e=>1-2*(1-r.aoAt(e));let s=n.crownC[1]+n.crownR[1],c=bh(t),l=t.range(0,Bh),u=(i-Math.hypot(a.c[0],a.c[2]))/1.42,d=Math.max(.2,Math.min(.8*a.r,(s-a.c[1])/1.42,u));for(let t of Uh.slice(0,3)){let n=yh(t,c,l),r=q(K(n,Math.abs(n[1])<.9?Vh:[1,0,0]));Xf(e,a.c,G(r,d),G(K(n,r),d),o)}}return}let o=t.range(0,Math.PI);for(let i=0;i<3;i++)l_(e,n,r,o+i*Math.PI/3,a?Z.conifer:Z.blob,a?H.cone:H.blob,t.next());let[s,c,l]=n.crownC,[u,d,f]=n.crownR;Xf(e,[s,c+.15*d,l],[u*.85,0,0],[0,0,f*.85],{rect:Wm(Z.blob),kind:H.blob,normalAt:()=>Vh,aoAt:()=>.8,swayAt:e=>r.swayAt(e[1]),phase:t.next()})}function p_(e,t,n,r={}){let i=r.dense===!0,a=Yh(e),o=[];Tg=a.swayAt,Eg=e.species===`juniper`?jg:Ag;for(let s of[0,1,2]){let c=new ue(O(t,269,s)),l=new Uf;if(bg=s===0?new Up:null,xg=s===0&&r.pieces?[]:null,s===2)f_(l,c,e,a);else{let t=ag(l,e,a,s,i),r=s===0?n:void 0;r?.wood.push(...t),og(l,c,e,a,s,t,r,i),c_(l,c,e,a,s,t,r,i)}bg&&r.report?.(bg),xg&&r.pieces?.(xg),xg=null,bg=null,o.push(l.build())}return Tg=null,o}var m_=Math.PI*2,h_=[0,1,0],g_=2.399963,__=(e,t,n)=>e+(t-e)*n;function v_(e,t,n,r,i,a,o){let s=[t],c=q(n),l=t;for(let t=1;t<=i;t++){let n=q([e.range(-1,1),e.range(-1,1),e.range(-1,1)]),u=typeof a==`number`?a:a(t/i);c=q(U(U(c,G(h_,u/i)),G(n,o/i))),l=U(l,G(c,r/i)),s.push(l)}return s}function y_(e,t,n,r=1){return Array.from({length:n},(i,a)=>__(e,t,(a/(n-1))**r))}function b_(e){let t=0;for(let n=1;n<e.pts.length;n++)t+=Math.hypot(e.pts[n][0]-e.pts[n-1][0],e.pts[n][1]-e.pts[n-1][1],e.pts[n][2]-e.pts[n-1][2]);return t}function x_(e,t){let n=Math.min(Math.max(t,0),1)*(e.radii.length-1),r=Math.min(Math.floor(n),e.radii.length-2);return __(e.radii[r],e.radii[r+1],n-r)}function S_(e,t,n){let r=n.levels[t.order-n.order0];if(t.order>=n.tipFrom&&n.tips.push({p:t.pts[t.pts.length-1],r:n.tipRadius[t.order]??.5,order:t.order,limb:t}),!r)return;let i=b_(t),a=e.range(0,m_);for(let o=0;o<r.count;o++){let s=__(r.start,r.end,(o+e.range(.15,.85))/r.count),c=xh(t.pts,s),l=Sh(t.pts,s),u=q(K(l,Math.abs(l[1])<.9?h_:[1,0,0])),d=K(l,u),f=a+o*g_+e.range(-.35,.35),p=e.range(r.angle[0],r.angle[1]),m=U(G(u,Math.cos(f)),G(d,Math.sin(f))),h=v_(e,c,q(U(G(l,Math.cos(p)),G(m,Math.sin(p)))),Math.max(.25,i*e.range(r.length[0],r.length[1])*(1-.35*s)),r.segs,r.bend,r.wobble),g=x_(t,s)*Math.min(r.radius,.9),_={pts:h,radii:y_(g,Math.min(r.tipRadius,g*.8),h.length,.85),order:t.order+1,parent:t};n.limbs.push(_),S_(e,_,n)}}function C_(e,t){for(let n=e;n;n=n.parent)if(n===t)return!0;return!1}function w_(e,t,n,r,i=1){let a=new Set;if(i<1){let t=Math.max(2,Math.round(n.pts.length*i));n.pts.length=t,n.radii.length=t,n.radii[t-1]*=.45;for(let r of e)r.parent===n&&T_(n,r.pts[0])>=t-1&&a.add(r)}for(let t=e.length-1;t>=0;t--){let i=e[t];if(!C_(i,n))continue;let o=!1;for(let e of a)C_(i,e)&&(o=!0);o||i.order>r&&i!==n?(a.add(i),e.splice(t,1)):i.dead=!0}for(let e=t.length-1;e>=0;e--)C_(t[e].limb,n)&&t.splice(e,1)}function T_(e,t){let n=0,r=1/0;return e.pts.forEach((e,i)=>{let a=Math.hypot(e[0]-t[0],e[1]-t[1],e[2]-t[2]);a<r&&(r=a,n=i)}),n}var E_=Math.PI*2,D_=(e,t,n)=>e+(t-e)*n;function O_(e,t){let n=1/0,r=1/0,i=1/0,a=-1/0,o=-1/0,s=-1/0;for(let t of e)n=Math.min(n,t[0]),a=Math.max(a,t[0]),r=Math.min(r,t[1]),o=Math.max(o,t[1]),i=Math.min(i,t[2]),s=Math.max(s,t[2]);return{c:[(n+a)/2,(r+o)/2,(i+s)/2],r:[(a-n)/2+t,(o-r)/2+t,(s-i)/2+t]}}function k_(e,t,n,r,i,a){for(let o=0;o<12;o++){let o=bh(e),s=D_(r,i,Math.cbrt(e.next())),c=[t[0]+o[0]*n[0]*s,t[1]+o[1]*n[1]*s,t[2]+o[2]*n[2]*s];if(c[1]>=a)return c}return[t[0],Math.max(t[1],a),t[2]]}function A_(e,t,n,r,i,a=0){let o=O_(t.map(e=>e.p),.8),s=t.map(e=>({c:e.p,r:e.r})),c=t.reduce((e,t)=>e+t.r,0)/Math.max(t.length,1);for(let l=0;l<n;l++)if(l<n*a&&t.length>0){let n=t[e.int(0,t.length-1)],r=q(U(q([n.p[0]-o.c[0],.6*Math.max(n.p[1]-o.c[1],0)+.5,n.p[2]-o.c[2]]),G(bh(e),.9)));s.push({c:U(n.p,G(r,n.r*e.range(.35,.8))),r:n.r*e.range(.85,1.1)})}else s.push({c:k_(e,o.c,o.r,i[0],i[1],r),r:c*e.range(.85,1.1)});return{clusters:s,...o}}function j_(e,t,n,r,i){let a=i.range(0,10),o=i.range(0,10),s=Eh(e,8).map(t=>{let i=Math.max(t,0)/e;return[Math.sin(n)*r*i*i+.05*Math.sin(i*7+a),t,Math.cos(n)*r*i*i+.05*Math.sin(i*5+o)]});return{pts:s,radii:s.map(n=>D_(t,t*.7,Math.max(n[1],0)/e)*(1+.55*Math.exp(-Math.max(n[1],0)/.5))),order:0}}function M_(e,t,n,r,i){let a=new ue(e),o=new Set(t.filter(e=>e.order===1).map(e=>e.parent));for(let e of t.filter(e=>e.order===1&&!e.root&&!o.has(e)))a.next()<r&&w_(t,n,e,2,a.next()<.6?a.range(.35,.85):1);for(let e of t.filter(e=>e.order===2&&!e.dead))a.next()<i&&w_(t,n,e,3,a.next()<.5?a.range(.3,.8):1)}var N_=[{count:3,start:.25,end:.9,angle:[.6,1.1],length:[.4,.6],segs:5,bend:.35,wobble:2.4,radius:.55,tipRadius:.02},{count:3,start:.2,end:.92,angle:[.5,1],length:[.42,.65],segs:4,bend:.1,wobble:2,radius:.58,tipRadius:.012},{count:2,start:.3,end:.95,angle:[.4,.9],length:[.5,.75],segs:3,bend:-.1,wobble:1.4,radius:.62,tipRadius:.006}],P_={count:2,start:.4,end:.95,angle:[.6,1.1],length:[.9,1.3],segs:4,bend:.4,wobble:2,radius:.45,tipRadius:.02},F_=250;function I_(e,t){let n=[],r=[];return e.forEach((i,a)=>(Math.floor((a+1)*t/e.length)>Math.floor(a*t/e.length)?n:r).push(i)),[...n,...r]}function L_(e,t,n){return y_(e,t,n,1.7)}function R_(e,t,n,r,i,a,o){return v_(e,t,n,r,i,a,o*i*.5)}function z_(e,t,n){let r=n.fork*t,i=e.range(0,E_),a=(.028*t+.05)*n.trunk,o=j_(r,a,i,.5,e),s=o.pts.length-1,c=[o],l=[],u=e.int(n.limbs[0],n.limbs[1]),d=a*.72,f=Array.from({length:u},()=>e.range(.8,1.2)),p=f.reduce((e,t)=>e+t,0),m={levels:N_.slice(0,2),order0:1,tipRadius:{3:.95},tipFrom:3,limbs:c,tips:l};for(let r=0;r<u;r++){let a=i+(r+e.range(-.1,.1))*E_/u,l=d*Math.sqrt(f[r]/p)*1.15,h=t*n.reach*e.range(.6,.72)*Math.sqrt(f[r]/(p/u)),g=o.pts[s-r%2],_=e.range(.35,.7)+.6*n.upright,v=e.range(.32,.5),y=R_(e,g,vh(a,Math.min(_,1.45)),h*v,4,()=>.35+n.upright,.55),b={pts:y,radii:L_(l,l*.8,y.length),order:1,parent:o};c.push(b),S_(e,b,{...m,levels:[P_,N_[1]]});let x=q([y[4][0]-y[3][0],y[4][1]-y[3][1],y[4][2]-y[3][2]]),S=Math.atan2(x[0],x[2]),C=Math.asin(Math.max(-1,Math.min(1,x[1]))),w=e.range(.35,.5);for(let[t,r]of[[0,1-w],[1,w]]){let i=(t===0?1:-1)*e.range(.4,.8),a=t===0?Math.min(C+e.range(.2,.45),1.3):Math.max(C-e.range(.3,.6),.05),o=vh(S+i,Math.max(-.2,Math.min(1.4,a))),s=h*(1-v)*(t===0?e.range(.95,1.1):e.range(1,1.2)),u=R_(e,y[4],o,s,6,e=>(t===0?.4:.45)+n.upright-.9*e,.45),d={pts:u,radii:L_(l*.8*Math.sqrt(r)*1.1,.03,u.length),order:1,parent:b};c.push(d),S_(e,d,m)}}for(let e of c){if(e.order===3)for(let t of[.3,.55,.8])l.push({p:xh(e.pts,t),r:.85,order:3,limb:e});e.order===2&&l.push({p:xh(e.pts,.7),r:.9,order:2,limb:e})}M_(Math.round(t*977+n.dead*131),c,l,n.dead,.05+.25*n.dead);let h={count:e.int(5,7),amp:.75,height:1,phase:e.next()};c.push(...jh(e,o,h,.5+2.5*a));let g=A_(e,l,Math.round(420*(1-.6*n.dead)),o.pts[s][1]+.2,[.45,.92],.4);n.dead>=.3&&c.push(Ah(Math.round(t*991)+7,o,.35*t,.35*a));let _=Math.min(g.clusters.length,F_),v=I_(g.clusters,_);return{species:`oak`,height:t,crownC:g.c,crownR:g.r,trunkRadius:Dh(o),bark:H.bark,limbs:c,fronds:[],clusters:v,midClusters:_,cardsPerCluster:11,cardSize:.45,radial:!1,foliage:H.leaf,trunkSides:[16,6,4],flare:h,gnarl:n.gnarl}}var B_=[{count:3,start:.25,end:.9,angle:[.4,.8],length:[.42,.62],segs:5,bend:.25,wobble:.55,radius:.55,tipRadius:.02},{count:3,start:.2,end:.95,angle:[.55,1],length:[.4,.62],segs:4,bend:-.15,wobble:.6,radius:.58,tipRadius:.01},{count:3,start:.2,end:.95,angle:[.6,1.1],length:[.45,.7],segs:3,bend:-.35,wobble:.5,radius:.6,tipRadius:.005}];function V_(e,t,n){let r=n.fork*t,i=e.range(0,E_),a=.02*t+.05,o=j_(r,a,i,.15,e),s=o.pts.length-1,c=[o],l=[],u=e.int(4,6);for(let d=0;d<u;d++){let f=i+(d+e.range(-.3,.3))*E_/u,p=(t-r)*e.range(.7,.95)*(.55+n.reach*.6),m=o.pts[s-d%2],h=v_(e,m,vh(f,e.range(.85,1.25)),p,8,e=>.35-1.2*e*(1.2-n.reach),.5),g={pts:h,radii:y_(a*.5,.03,h.length,.75),order:1,parent:o};c.push(g),S_(e,g,{levels:B_,order0:1,tipRadius:{2:.9,3:.85,4:.7},tipFrom:3,limbs:c,tips:l})}M_(Math.round(t*977+17),c,l,.03,.08);let d={count:e.int(5,7),amp:.42,height:.85,phase:e.next()};c.push(...jh(e,o,d,.5+2.5*a));let f=A_(e,l,34,o.pts[s][1]+.5,[.55,1]);return{species:`beech`,height:t,crownC:f.c,crownR:f.r,trunkRadius:Dh(o),bark:H.beechBark,limbs:c,fronds:[],clusters:f.clusters,cardsPerCluster:10,cardSize:.3,radial:!1,foliage:H.leaf,trunkSides:[16,6,4],flare:d,gnarl:.02}}var H_=e=>[{count:3,start:.25,end:.9,angle:[.5,.95],length:[.4,.6],segs:4,bend:-.9-.6*e,wobble:1,radius:.55,tipRadius:.01},{count:3,start:.2,end:.95,angle:[.45,.9],length:[.4+.25*e,.65+.35*e],segs:3,bend:-1.2-1.6*e,wobble:1,radius:.6,tipRadius:.006}];function U_(e,t,n,r,i,a,o){let s=[],c=[];for(let l of Eh(e,9)){let u=Math.max(l,0)/e,d=o?u*(2-u):u*u;s.push([i[0]+Math.sin(n)*r*d+.16*Math.sin(u*5.5+a),l,i[2]+Math.cos(n)*r*d+.16*Math.sin(u*4.1+1+a)]),c.push(D_(t,.015,u**.8)*(1+.45*Math.exp(-Math.max(l,0)/.4)))}return{pts:s,radii:c,order:0}}function W_(e,t,n){let r=e.range(0,E_),i=(.0085*t+.05)*(n.stems>1?.78:1),a=H_(n.weep),o=[],s=[],c=[];for(let l=0;l<n.stems;l++){let u=n.stems>1?r+l*E_/n.stems+e.range(-.4,.4):r,d=t*(l===0?1:e.range(.78,.95)),f=n.stems>1?d*e.range(.1,.18):.9,p=n.stems>1?[Math.sin(u)*i*.7,0,Math.cos(u)*i*.7]:[0,0,0],m=U_(d,i*(l===0?1:.85),u,f,p,n.stems>1?e.range(0,E_):0,n.stems>1);c.push(m),o.push(m),s.push({p:m.pts[m.pts.length-1],r:.8,order:0,limb:m});let h=n.stems>1?7:10;for(let t=0;t<h;t++){let r=t/(h-1),i=d*D_(.36,.93,r)+e.range(-.25,.25),c=Math.max(.9,D_(2.8,.9,r)*e.range(.85,1.15)*(n.stems>1?.8:1)),l=n.stems>1?u+e.range(-1.6,1.6):e.range(0,E_),f=v_(e,G_(m,i),vh(l,D_(.35,.95,r)),c,5,e=>.5-(1.7+1.2*n.weep)*e,.35),p={pts:f,radii:y_(.03+.02*c,.008,f.length),order:1,parent:m};o.push(p),S_(e,p,{levels:a,order0:1,tipRadius:{1:.7,2:.6,3:.55},tipFrom:2,limbs:o,tips:s})}}M_(Math.round(t*977+29*n.stems),o,s,.03,.05);let l={count:e.int(4,6),amp:.25,height:.35,phase:e.next()};n.stems===1&&o.push(...jh(e,c[0],l,.3+1.5*i));let u=A_(e,s,8,t*.4,[.6,1]);return{species:`birch`,height:t,crownC:u.c,crownR:u.r,trunkRadius:Dh(c[0]),bark:H.birchBark,limbs:o,fronds:[],clusters:u.clusters,cardsPerCluster:9,cardSize:.25,radial:!1,foliage:H.leaf,trunkSides:[12,5,4],flare:n.stems===1?l:{...l,amp:.12},gnarl:.02}}function G_(e,t){let n=e.pts,r=0;for(;r<n.length-2&&n[r+1][1]<t;)r++;let i=Math.min(Math.max((t-n[r][1])/Math.max(n[r+1][1]-n[r][1],1e-6),0),1);return[D_(n[r][0],n[r+1][0],i),t,D_(n[r][2],n[r+1][2],i)]}function K_(e,t,n){let r=[],i=[],a;if(n.conifer){let i=t/n.broken,o=t,s=.0165*i+.05,c=[],l=[],u=e.range(0,E_),d=e.range(0,10);for(let e of Eh(o,10)){let t=Math.max(e,0)/i;c.push([Math.sin(u)*.5*t*t+.04*Math.sin(t*9+d),e,Math.cos(u)*.5*t*t+.04*Math.cos(t*7+d)]),l.push((.02+(s-.02)*(1-t)**1.2)*(1+.35*Math.exp(-Math.max(e,0)/.45)))}l[l.length-1]*=.4,a={pts:c,radii:l,order:0,dead:!0},r.push(a);for(let t=1.5;t<o-.6;t+=e.range(.5,.9)){let n=e.int(2,4),o=e.range(0,E_);for(let s=0;s<n;s++){let c=e.next()<.75?e.range(.1,.35):e.range(.6,1.6)*(1-t/i),l=vh(o+E_*s/n+e.range(-.3,.3),e.range(-.5,.1)),u=v_(e,G_(a,t),l,c,c>.5?3:1,-.3,.4);r.push({pts:u,radii:y_(Math.min(.015+.02*c,.05),.006,u.length),order:1,dead:!0,parent:a})}}}else{let n=t/.72,o=n*.3,s=.022*n+.05,c=e.range(0,E_);a={...j_(o,s,c,.4,e),dead:!0},r.push(a);let l=a.pts.length-1;for(let t=0;t<4;t++){let o=c+(t+e.range(-.3,.3))*E_/4,u=v_(e,a.pts[l-t%2],vh(o,e.range(.7,1.25)),n*e.range(.3,.5),7,e=>.6-1.2*e,1.2),d={pts:u,radii:y_(s*.45,.03,u.length,.8),order:1,parent:a};r.push(d),S_(e,d,{levels:N_.slice(0,1),order0:1,tipRadius:{},tipFrom:9,limbs:r,tips:i}),w_(r,i,d,2,e.next()<.7?e.range(.3,.75):1)}}let o={count:e.int(5,7),amp:.4,height:.6,phase:e.next()},s=jh(e,a,o,.4+1.8*a.radii[2]);for(let e of s)e.dead=!0;r.push(...s);let c=O_(r.filter(e=>!e.root).flatMap(e=>[e.pts[e.pts.length-1]]),.5);return r.push(n.conifer?Ah(Math.round(t*983)+5,a,t/n.broken-t,a.radii[a.radii.length-1]/.4):Ah(Math.round(t*983)+9,a,.45*t,.12+.01*t)),{species:`snag`,height:t,crownC:c.c,crownR:c.r,trunkRadius:Dh(a),bark:H.deadWood,limbs:r,fronds:[],clusters:[],cardsPerCluster:0,cardSize:0,radial:!1,foliage:H.leaf,trunkSides:[14,6,4],flare:o,gnarl:.05}}var q_=[{count:3,start:.3,end:.9,angle:[.5,1],length:[.4,.6],segs:3,bend:.1,wobble:.4,radius:.6,tipRadius:.006}];function J_(e,t){let n=[],r=[];for(let i=0;i<8;i++){let a=v_(e,[0,-.1,0],vh(i/8*E_+e.range(-.3,.3),e.range(.6,1.2)),t*e.range(.42,.62),4,e=>.2-.7*e,.4),o={pts:a,radii:y_(.028,.006,a.length),order:1};n.push(o),S_(e,o,{levels:q_,order0:1,tipRadius:{1:.5,2:.4},tipFrom:1,limbs:n,tips:r})}let i=A_(e,r,9,.25,[.5,1]);return{species:`bush`,height:t,crownC:i.c,crownR:i.r,trunkRadius:.03,bark:H.bark,limbs:n,fronds:[],clusters:i.clusters,cardsPerCluster:6,cardSize:.17,radial:!1,foliage:H.leaf,trunkSides:[4,4,3]}}function Y_(e,t){let n=[],r=[];for(let r=0;r<3;r++){let r=v_(e,[0,-.1,0],vh(e.range(0,E_),1.3),t*.45,3,.2,.3);n.push({pts:r,radii:y_(.03,.012,r.length),order:1})}for(let n=0;n<20;n++){let i=q(vh(n*2.399963%E_,D_(.25,1.25,n*7%20/20))),a=t*e.range(.65,.95);r.push({c:U([0,.03,0],G(i,a*.5)),t:i,len:a,width:a*.7,branch:n})}let i=t*.5;return{species:`juniper`,height:t,crownC:[0,t*.5,0],crownR:[i,t*.55,i],trunkRadius:.03,bark:H.bark,limbs:n,fronds:r,clusters:[],cardsPerCluster:0,cardSize:0,radial:!1,foliage:H.needle,trunkSides:[4,4,3]}}var X_=e=>Q[e].group===`rock`,Z_=(e,t,n,r,i,a,o,s,c=[4.5,16])=>({name:e,group:`tree`,height:t,spacing:n,seed:r,plan:i,rock:-1,swayHz:a[0],swayStrength:a[1],flutter:a[2],tone:o,translucency:s,lodRatio:c}),Q_=(e,t,n,r,i,a,o,s)=>({...Z_(e,t,n,r,i,a,o,s),group:`bush`,lodRatio:[28,80]}),$_=(e,t,n)=>({name:e,group:`rock`,height:1,spacing:.9,seed:t,plan:null,rock:t,swayHz:0,swayStrength:0,flutter:0,tone:n,translucency:0,lodRatio:[30,90]}),Q=[Z_(`spruce open`,18,3.2,23041,e=>Ih(e,18,{reach:.31,crownBase:.1,deadBelow:!1,droop:.5,lean:.35}),[.45,.003,.03],[.03,.075,.043],.3),Z_(`spruce forest`,22,3.2,23042,e=>Ih(e,22,{reach:.22,crownBase:.38,deadBelow:!0,droop:.3,lean:.25}),[.42,.003,.03],[.032,.079,.046],.3),Z_(`pine forest`,19.5,4.2,23050,e=>Rh(e,19.5,{crownStart:.6,limbs:14,spread:.9,lean:.9,wobble:.1,stubs:7}),[.36,.0042,.03],[.042,.088,.046],.3),Z_(`oak open`,20,5.2,23044,e=>z_(e,20,{fork:.17,limbs:[4,6],reach:1,upright:.1,trunk:1,dead:.04,gnarl:.07}),[.33,.0028,.04],[.058,.12,.038],.45,[3,10.8]),Z_(`oak forest`,25,5.2,23045,e=>z_(e,25,{fork:.42,limbs:[4,5],reach:.55,upright:.5,trunk:.85,dead:.12,gnarl:.05}),[.31,.0028,.04],[.064,.126,.04],.45,[3.8,13.5]),Z_(`birch`,16,3.6,23046,e=>W_(e,16,{stems:1,weep:0}),[.65,.006,.04],[.07,.135,.044],.5),Q_(`bush`,1.6,1.7,23047,e=>J_(e,1.6),[1.1,.004,.04],[.052,.105,.036],.45),Q_(`juniper`,1.3,1.6,23048,e=>Y_(e,1.3),[.9,.004,.03],[.036,.078,.05],.3),Z_(`spruce old`,21,3.4,23049,e=>Ih(e,21,{reach:.28,crownBase:.24,deadBelow:!0,droop:1,lean:.55}),[.42,.003,.03],[.028,.07,.044],.3),Z_(`pine open`,17,4.2,23043,e=>Rh(e,17,{crownStart:.4,limbs:20,spread:1.25,lean:1.4,wobble:.22,stubs:3}),[.38,.0042,.03],[.04,.085,.046],.3),Z_(`pine crooked`,18.5,4.2,23051,e=>Rh(e,18.5,{crownStart:.55,limbs:16,spread:1.05,lean:3.2,wobble:.45,stubs:4}),[.38,.0045,.03],[.038,.082,.046],.3),Z_(`oak veteran`,16,5.4,23052,e=>z_(e,16,{fork:.2,limbs:[4,5],reach:1,upright:.25,trunk:1.55,dead:.4,gnarl:.12}),[.3,.0024,.04],[.06,.118,.038],.45,[3.2,11.4]),Z_(`birch clump`,15,3.6,23053,e=>W_(e,15,{stems:3,weep:.2}),[.68,.006,.04],[.068,.132,.046],.5),Z_(`birch weeping`,17,3.8,23054,e=>W_(e,17,{stems:1,weep:1}),[.62,.006,.04],[.072,.138,.044],.5),Z_(`beech open`,22,5.4,23055,e=>V_(e,22,{fork:.22,reach:.9}),[.32,.0026,.04],[.062,.13,.036],.5),Z_(`beech forest`,30,5.2,23056,e=>V_(e,30,{fork:.46,reach:.5}),[.3,.0026,.04],[.058,.126,.036],.5),Z_(`snag conifer`,14,3.2,23057,e=>K_(e,14,{conifer:!0,broken:.68}),[.3,.0012,0],[.05,.05,.05],0),Z_(`snag broadleaf`,10,4.2,23058,e=>K_(e,10,{conifer:!1,broken:1}),[.3,.0015,0],[.05,.05,.05],0),$_(`angular rock`,0,[.3,.29,.27]),$_(`round boulder`,1,[.27,.26,.24]),$_(`flat slab`,2,[.34,.31,.27]),$_(`tall chunk`,3,[.28,.27,.26])],$={spruce:[0,1,8],pine:[9,2,10],oak:[3,4,11],birch:[12,5,13],beech:[14,15],snag:[16,17],bush:[6],juniper:[7],rock:[18,19,20,21]},ev=[];function tv(e){if(ev[e]===void 0){let t=Q[e];ev[e]=t.plan?t.plan(new ue(t.seed)):null}return ev[e]}var nv={"spruce open":{crown:5.859,top:18,crownTop:19.080000000000002,trunk:.30883139247709107},"spruce forest":{crown:5.082,top:22,crownTop:23.32,trunk:.377444239994894},"pine forest":{crown:4.393045984979251,top:19.5,crownTop:21.20899818302396,trunk:.3283538095866827},"oak open":{crown:12.502572382502073,top:17.078635186435562,crownTop:17.878635186435563,trunk:.5620898659787166},"oak forest":{crown:6.641321776589879,top:20.117748555532,crownTop:20.917748555532,trunk:.6493176001043693},birch:{crown:3.084935198612871,top:16,crownTop:16.8,trunk:.16848571985520766},bush:{crown:1.4690340919623504,top:.8350295910028345,crownTop:1.6350295910028345,trunk:.03},juniper:{crown:.65,top:1.3,crownTop:1.3650000000000002,trunk:.03},"spruce old":{crown:6.174000000000001,top:21,crownTop:22.26,trunk:.3602933508782565},"pine open":{crown:6.285019408290031,top:17,crownTop:19.191156080352815,trunk:.2879465857800804},"pine crooked":{crown:4.9702813842218525,top:18.5,crownTop:20.15712573015106,trunk:.3121957574180043},"oak veteran":{crown:7.832299420369366,top:14.45869608727261,crownTop:15.258696087272611,trunk:.7058441811910107},"birch clump":{crown:3.91888379796249,top:15,crownTop:15.8,trunk:.12497559580035739},"birch weeping":{crown:3.1643255418795455,top:17,crownTop:17.8,trunk:.17733318163026734},"beech open":{crown:10.793974798978384,top:24.521950810134815,crownTop:25.321950810134815,trunk:.47127364135457145},"beech forest":{crown:8.220815614264287,top:26.422206824240074,crownTop:27.222206824240075,trunk:.6704354070159076},"snag conifer":{crown:1.3487823613608731,top:13.7,crownTop:14.5,trunk:.37281647716976973},"snag broadleaf":{crown:3.0837791071140916,top:9.774308380852892,crownTop:10.574308380852893,trunk:.3363964276945343}};function rv(e){return Q[e].plan?nv[Q[e].name]??null:null}function iv(e){let t=1/0,n=-1/0;for(let r of e)for(let e=0;e<r.vertexCount;e++)t=Math.min(t,r.pos[e*3+1]),n=Math.max(n,r.pos[e*3+1]);let r=(t+n)/2,i=0;for(let t of e)for(let e=0;e<t.vertexCount;e++)i=Math.max(i,Math.hypot(t.pos[e*3],t.pos[e*3+1]-r,t.pos[e*3+2]));return{height:n,centreY:r,radius:i}}var av=[];function ov(e){return av[e]??=p_(tv(e),Q[e].seed)}function sv(e){e.forEach((e,t)=>{e.def.plan&&e.lods.length===3&&(av[t]??=e.lods)})}function*cv(e=!1,t){let n=_p();yield;let r=[];for(let i=0;i<Q.length;i++){let a=Q[i];if(a.rock>=0){let e=n[a.rock];r.push({def:a,lods:e.lods,height:e.height,centreY:e.centreY,radius:e.radius})}else r.push(t?.[i]??lv(i,e));yield}return r}function lv(e,t=!1){let n=Q[e],r=tv(e),i=t?p_(Th(r),n.seed,void 0,{dense:t}):ov(e);return{def:n,lods:i,...iv(i)}}function uv(e=8,t,n=!1,r){return yp(cv(n,r),e,t)}var dv=.045,fv=1.25,pv=.02,mv=24e3,hv=.5,gv=.04,_v=.4,vv=.8,yv=6,bv=12,xv=new Map;function Sv(e){let t=tv(e),n=[],r=t.limbs.filter(e=>e.order===0||e.order===1&&e.radii[0]>=dv),i=Math.max(1,Math.ceil(r.length*120*19/mv));return r.forEach((e,t)=>{if(e.order===1&&t%i)return;let r=e.order===0?fv:1,a=(e,t,r)=>{let i=Math.abs(t[1])<.95?[0,1,0]:[1,0,0],a=[t[1]*i[2]-t[2]*i[1],t[2]*i[0]-t[0]*i[2],t[0]*i[1]-t[1]*i[0]],o=Math.hypot(a[0],a[1],a[2])||1,s=[a[0]/o,a[1]/o,a[2]/o],c=[t[1]*s[2]-t[2]*s[1],t[2]*s[0]-t[0]*s[2],t[0]*s[1]-t[1]*s[0]],l=(e,t,r)=>{t>=.02&&n.push(e,t,r)};l(e[0],e[1],e[2]);for(let[t,n]of[[yv,.5],[bv,1]])for(let i=0;i<t;i++){let a=i/t*Math.PI*2+(n<1?Math.PI/t:0),o=Math.cos(a)*r*n,u=Math.sin(a)*r*n;l(e[0]+s[0]*o+c[0]*u,e[1]+s[1]*o+c[1]*u,e[2]+s[2]*o+c[2]*u)}};for(let t=0;t+1<e.pts.length;t++){let n=e.pts[t],i=e.pts[t+1],o=Math.hypot(i[0]-n[0],i[1]-n[1],i[2]-n[2])||1e-6,s=[(i[0]-n[0])/o,(i[1]-n[1])/o,(i[2]-n[2])/o],c=e.radii[t]*r,l=e.radii[t+1]*r,u=e.order===0&&Math.min(n[1],i[1])<vv?gv:Math.min(_v,Math.max(gv,hv*Math.min(c,l))),d=Math.ceil(o/u);for(let e=0;e<d;e++){let t=e/d;a([n[0]+(i[0]-n[0])*t,n[1]+(i[1]-n[1])*t,n[2]+(i[2]-n[2])*t],s,c+(l-c)*t)}t+2===e.pts.length&&a(i,s,l)}}),n}function Cv(e){let t=ov(e)[0],n=[];for(let e=0;e<t.idx.length;e+=3){let r=t.idx[e],i=t.idx[e+1],a=t.idx[e+2];if(!(t.attr[r*4+2]<H.leaf))for(let e of[r,i,a])for(let r=0;r<3;r++)n.push(t.pos[e*3+r])}return n}function wv(e){let t=[];for(let n=0;n<e.length;n+=9)if(!(n/9%2)){for(let r=0;r<3;r++)t.push((e[n+r]+e[n+3+r]+e[n+6+r])/3);for(let r=0;r<9;r++)t.push(e[n+r])}return t}function Tv(e){let t=xv.get(e);if(!t){let n=Float32Array.from(Sv(e)),r=Float32Array.from(Cv(e));t={wood:n,leaves:Float32Array.from(wv(r)),leafTriangles:r},xv.set(e,t)}return t}var Ev={albedo:[.045,.09,.025],roughness:1,metalness:0},Dv={albedo:[.13,.085,.05],roughness:.95,metalness:0},Ov=.015,kv=.05,Av=6,jv=2,Mv=3,Nv=.5,Pv=.5,Fv=.9,Iv=(e,t)=>[e[0]-t[0],e[1]-t[1],e[2]-t[2]],Lv=e=>Math.hypot(e[0],e[1],e[2]);function Rv(e,t,n){let r=Iv(n,t),i=r[0]*r[0]+r[1]*r[1]+r[2]*r[2]||1,a=Math.max(0,Math.min(1,((e[0]-t[0])*r[0]+(e[1]-t[1])*r[1]+(e[2]-t[2])*r[2])/i));return Lv(Iv(e,[t[0]+r[0]*a,t[1]+r[1]*a,t[2]+r[2]*a]))}function zv(e,t,n,r,i){let a=[n],o=(n,r)=>{let s=0,c=-1,l=1/0,u=0;for(let e=n;e<=r;e++)l=Math.min(l,t[e]),u=Math.max(u,t[e]);for(let t=n+1;t<r;t++){let i=Rv(e[t],e[n],e[r]);i>s&&(s=i,c=t)}if(c>0&&s>Math.max(.01,Nv*i*l))o(n,c),o(c,r);else if(r-n>1&&u>(1+Pv*i)*l){let e=n+r>>1;o(n,e),o(e,r)}else a.push(r)};return o(n,r),a}function Bv(e,t){let n=1/0,r=0;for(let r=0;r<=t;r++)n=Math.min(n,e.radii[r]);for(let n=1;n<t;n++)r=Math.max(r,Rv(e.pts[n],e.pts[0],e.pts[t]));return r<=Math.max(.01,Nv*n)}function Vv(e,t,n,r){let i=1,a=zv(e.pts,e.radii,t,n,i);for(;a.length-1>r&&i<64;)i*=1.4,a=zv(e.pts,e.radii,t,n,i);let o=[];for(let t=1;t<a.length;t++){let n=0,r=0;for(let i=a[t-1];i<=a[t];i++)n+=e.radii[i],r++;o.push({a:e.pts[a[t-1]],b:e.pts[a[t]],radius:n/r*Fv})}return o}var Hv=new Map,Uv=e=>Math.max(0,Math.min(e.pts.findIndex(e=>e[1]>=-.2),e.pts.length-2));function Wv(e){let t=Hv.get(e);if(t)return t;let n=tv(e),r=n.limbs.filter(e=>e.order===0),i=[],a=r.flatMap(e=>Vv(e,Uv(e),e.pts.length-1,Math.max(2,Math.floor(Av/r.length)))),o=n.limbs.filter(e=>e.order===1&&!e.root&&e.radii[0]>=kv).sort((e,t)=>t.radii[0]-e.radii[0]).slice(0,Mv);for(let e of o){let t=1;for(;t+1<e.pts.length&&e.radii[t+1]>=Math.max(.03,.45*e.radii[0])&&Bv(e,t+1);)t++;t===1&&e.pts.length>2&&e.radii[2]>=Math.max(.03,.45*e.radii[0])&&(t=2),i.push(...Vv(e,0,t,jv))}return t={trunk:a,limbs:i},Hv.set(e,t),t}var Gv=(e,t,n,r)=>{let i=Math.cos(t),a=Math.sin(t),o=n[0]*r,s=n[1]*r,c=n[2]*r;return[e[0]+i*o+a*c,e[1]+s,e[2]-a*o+i*c]};function Kv(e,t,n=!0,r=10){let i=[];if(Q[e].group!==`tree`)return i;let a=Wv(e);for(let e of n?[...a.trunk,...a.limbs]:a.trunk){if(i.length>=r)break;let n=e.radius*t.scale;n<Ov||i.push({type:`capsule`,a:Gv(t.pos,t.yaw,e.a,t.scale),b:Gv(t.pos,t.yaw,e.b,t.scale),radius:n,material:Dv})}return i}var qv=new Map;function Jv(e){return{center:e.crownC,radius:Math.cbrt(e.crownR[0]*e.crownR[1]*e.crownR[2])}}function Yv(e,t){let n=e.length/3,r=1/0,i=-1/0;for(let t=0;t<n;t++)r=Math.min(r,e[t*3+1]),i=Math.max(i,e[t*3+1]);let a=[];for(let o=0;o<t;o++){let s=r+(i-r)*(o+.5)/t,c=0,l=1/0;for(let t=0;t<n;t++){let n=Math.abs(e[t*3+1]-s);n<l&&(l=n,c=t)}a.push([e[c*3],e[c*3+1],e[c*3+2]])}let o=new Int32Array(n),s=a.map(()=>[0,0,0,0]),c=()=>{for(let e of s)e.fill(0);for(let r=0;r<n;r++){let n=0,i=1/0;for(let o=0;o<t;o++){let t=(e[r*3]-a[o][0])**2+(e[r*3+1]-a[o][1])**2+(e[r*3+2]-a[o][2])**2;t<i&&(i=t,n=o)}o[r]=n;let c=s[n];c[0]+=e[r*3],c[1]+=e[r*3+1],c[2]+=e[r*3+2],c[3]++}};for(let e=0;e<24;e++){c();for(let e=0;e<t;e++)s[e][3]&&(a[e]=[s[e][0]/s[e][3],s[e][1]/s[e][3],s[e][2]/s[e][3]])}c();let l=a.map(()=>0);for(let t=0;t<n;t++)l[o[t]]+=(e[t*3]-a[o[t]][0])**2+(e[t*3+1]-a[o[t]][1])**2+(e[t*3+2]-a[o[t]][2])**2;return a.map((e,t)=>({center:e,radius:Math.sqrt(5/3*l[t]/Math.max(1,s[t][3]))})).filter((e,t)=>s[t][3]>0)}function Xv(e,t){let n=Tv(e).leafTriangles,r=[];for(let e=0;e<n.length;e+=9){let i=(t,r)=>Math.hypot(n[e+t*3]-n[e+r*3],n[e+t*3+1]-n[e+r*3+1],n[e+t*3+2]-n[e+r*3+2]),a=Math.max(1,Math.min(32,Math.ceil(Math.max(i(0,1),i(1,2),i(2,0))/t))),o=(t,i)=>{for(let a=0;a<3;a++)r.push(n[e+a]+(n[e+3+a]-n[e+a])*t+(n[e+6+a]-n[e+a])*i)};for(let e=0;e<a;e++)for(let t=0;t<a-e;t++)o((e+1/3)/a,(t+1/3)/a),e+t<a-1&&o((e+2/3)/a,(t+2/3)/a)}return Float32Array.from(r)}function Zv(e,t,n){let r=(e,t,n)=>((e+512)*1024+(t+512))*1024+(n+512),i=new Set;for(let t=0;t<e.length;t+=3){let a=Math.floor(e[t]/n),o=Math.floor(e[t+1]/n),s=Math.floor(e[t+2]/n);i.add(r(a,o,s))}let a=new Set;for(let e of t){let t=Math.ceil(e.radius/n)+1,i=Math.floor(e.center[0]/n),o=Math.floor(e.center[1]/n),s=Math.floor(e.center[2]/n);for(let c=i-t;c<=i+t;c++)for(let i=o-t;i<=o+t;i++)for(let o=s-t;o<=s+t;o++)Math.hypot((c+.5)*n-e.center[0],(i+.5)*n-e.center[1],(o+.5)*n-e.center[2])<=e.radius&&a.add(r(c,i,o))}let o=0;for(let e of a)i.has(e)&&o++;return o/(a.size+i.size-o||1)}var Qv=.05;function $v(e){let t=qv.get(e);if(t)return t;let n=tv(e),r=Math.max(.05,Math.max(...n.crownR)/14),i=Xv(e,r/2),a=[Jv(n)],o=Zv(i,a,r),s=Yv(i,1),c=Zv(i,s,r);c>o&&(a=s,o=c);for(let e=2;e<=3;e++){let t=Yv(i,e),n=Zv(i,t,r);n>=o+Qv&&(a=t,o=n)}return t=a,qv.set(e,t),t}function ey(e,t){return $v(e).map(e=>({type:`sphere`,center:Gv(t.pos,t.yaw,e.center,t.scale),radius:e.radius*t.scale,material:Ev}))}var ty=2400,ny=.15,ry=1.2,iy=.9,ay=.7,oy=1500,sy=16e3,cy=3e3,ly=e=>Math.min(cy,Math.floor(e/4)),uy=1024;function dy(e,t){return Math.max(0,Math.min(e?sy:oy,vd-uy-t))}var fy={albedo:[.27,.26,.24],roughness:.95,metalness:0},py=4,my=.6,hy=.25,gy=new Map;function _y(e,t){let n=e.pts,r=0;for(;r<n.length-2&&n[r+1][1]<t;)r++;let i=Math.min(Math.max((t-n[r][1])/Math.max(n[r+1][1]-n[r][1],1e-6),0),1);return[n[r][0]+(n[r+1][0]-n[r][0])*i,n[r][2]+(n[r+1][2]-n[r][2])*i,e.radii[r]+(e.radii[r+1]-e.radii[r])*i]}function vy(e){let t=gy.get(e);if(t)return t;let n=tv(e),r=[],i=Math.min(n.height*iy,rv(e)?.crownTop??n.crownC[1]+n.crownR[1]),a=n.limbs.filter(e=>e.order===0),o=Math.min(py,Math.max(1,Math.floor(6/a.length)));for(let e of a){let t=i,n=(n,r,i)=>{let a=1/0,o=-1/0,s=1/0,c=-1/0;for(let t=0;t<=16;t++){let[i,l]=_y(e,n+(r-n)*t/16);a=Math.min(a,i),o=Math.max(o,i),s=Math.min(s,l),c=Math.max(c,l)}let l=i?_y(e,Math.min(_h,t))[2]:_y(e,(n+r)/2)[2];return{x:(a+o)/2,z:(s+c)/2,y0:n,y1:r,radius:l,spread:Math.max(o-a,c-s)/2}},a=[];for(let e=1;e<=o&&(a=Array.from({length:e},(r,i)=>n(t*i/e,t*(i+1)/e,i===0)),!a.every(e=>e.spread<=Math.max(my*e.radius,hy)));e++);r.push(...a)}return gy.set(e,r),r}function yy(e,t){let n=e.scale[t],r=e.yaw[t],i=Math.cos(r),a=Math.sin(r);return vy(e.variant[t]).map(o=>{let s=Math.min(Math.max(o.radius*n,ny),ry)+o.spread*n,c=o.x*n,l=o.z*n,u=.5*(o.y1-o.y0)*n;return{kind:`box`,center:[e.pos[t*3]+i*c+a*l,e.pos[t*3+1]+o.y0*n+u,e.pos[t*3+2]-a*c+i*l],half:[s,u,s],yaw:r}})}function by(e,t){let n=e.scale[t],r=.5*_p()[Q[e.variant[t]].rock].height*n;return{kind:`box`,center:[e.pos[t*3],e.pos[t*3+1]+r,e.pos[t*3+2]],half:[ay*n,r,ay*n],yaw:e.yaw[t]}}function xy(e){let t=[],{plants:n,rocks:r}=e;for(let e=0;e<n.count;e++)if(Q[n.variant[e]].group===`tree`&&n.pathDist[e]<=60)for(let r of yy(n,e))t.push({dist:n.pathDist[e],key:e,box:r});for(let e=0;e<r.count;e++)r.scale[e]<.6||!(r.pathDist[e]<=40)||t.push({dist:r.pathDist[e],key:n.count+e,box:by(r,e)});return t.sort((e,t)=>e.dist-t.dist||e.key-t.key),t.length>2400&&(t.length=ty),t.map(e=>e.box)}var Sy=[];function Cy(e){if(!Sy[e]){let t=_p()[e].lods[0],n=[1/0,1/0,1/0],r=[-1/0,-1/0,-1/0];for(let e=0;e<t.vertexCount;e++)for(let i=0;i<3;i++)n[i]=Math.min(n[i],t.pos[e*3+i]),r[i]=Math.max(r[i],t.pos[e*3+i]);Sy[e]={center:[(n[0]+r[0])/2,(n[1]+r[1])/2,(n[2]+r[2])/2],half:[(r[0]-n[0])/2,(r[1]-n[1])/2,(r[2]-n[2])/2]}}return Sy[e]}var wy=1e6,Ty=(e,t)=>t?-1-e:e;function Ey(e,t,n=oy,r={}){let{plants:i,rocks:a}=e,o=[],s=(e,n)=>Math.hypot(e.pos[n*3]-t[0],e.pos[n*3+2]-t[2]),c=(e,t)=>r.alongLine?Number.isFinite(e.pathDist[t])?e.pathDist[t]:wy+s(e,t):s(e,t),l=r.within??1/0,u=(e,t,n)=>{n<=l&&!r.skip?.has(Ty(e,t))&&o.push({d:n,i:e,rock:t})};for(let e=0;e<i.count;e++)u(e,!1,c(i,e));for(let e=0;e<a.count;e++)a.scale[e]>=.3&&u(e,!0,c(a,e));o.sort((e,t)=>e.d-t.d||+e.rock-t.rock||e.i-t.i);let d=[];for(let{i:e,rock:t}of o){if(d.length>=n)break;let o=t?a:i,s=o.variant[e],c=[o.pos[e*3],o.pos[e*3+1],o.pos[e*3+2]],l={pos:c,yaw:o.yaw[e],scale:o.scale[e]},u;if(t){let e=Cy(Q[s].rock),t=Math.cos(l.yaw),n=Math.sin(l.yaw),r=e.center[0]*l.scale,i=e.center[2]*l.scale;u=[{type:`ellipsoid`,center:[c[0]+t*r+n*i,c[1]+e.center[1]*l.scale,c[2]-n*r+t*i],half:e.half.map(e=>e*l.scale),rot:[0,Math.sin(l.yaw/2),0,Math.cos(l.yaw/2)],material:fy}]}else if(tv(s))u=[...Kv(s,l,!1),...ey(s,l)];else continue;if(d.length+u.length>n)break;d.push(...u),r.taken?.add(Ty(e,t))}return d}var Dy=Math.tan(30*Math.PI/180),Oy=1.45,ky=.85,Ay=.32,jy=1.5,My=.16,Ny=(e,t,n,r)=>{let i=e=>Math.round(Math.min(Math.max(e*.5,0),1)*255);return(i(e)|i(t)<<8|i(n)<<16|i(r)<<24)>>>0},Py=1.6;function Fy(e,t,n,r){let i=tv(t);if(!i||i.foliage!==H.leaf||i.clusters.length===0)return e;let a=3/Math.sqrt(Math.max(r,.02)),o=Math.max(i.crownR[0],i.crownR[2])*n,s=Math.min(Math.max(.6*a/Math.max(o,.1),1),Py);return(e&16777215|Math.round(s*127.5)<<24)>>>0}var Iy=class{f;sStand;sLine;sBush;sConifer;sClump;sDraw;sAge;sGlade;sBeech;lo;range;water;constructor(e,t){this.f=e;let n=e=>O(t,e)|0;this.sStand=n(1),this.sLine=n(2),this.sBush=n(3),this.sConifer=n(4),this.sClump=n(5),this.sDraw=n(6),this.sAge=n(7),this.sGlade=n(8),this.sBeech=n(9),this.lo=e.data.minHeight,this.range=Math.max(e.data.maxHeight-e.data.minHeight,1),this.water=e.data.waterLevel}draw(e,t,n){return J(e,t,this.sDraw+n*7919)}conifer(e,t,n,r){return Y(0,.4,n+.5*(rp(e/260,t/260,this.sConifer,2)-.5))*(1-.35*r)}plant(e,t,n,r,i){let a=this.f,o=Y(.42,.57,rp(n/380,r/380,this.sStand,3)),s=Y(.62,.76,rp(n/85,r/85,this.sGlade,2)),c=(.03+.97*o)*(1-.88*s),l=.3*(.3+.7*Y(.35,.65,rp(n/70,r/70,this.sBush,2)))*(.4+.6*o)*(1+.8*s),u=this.draw(e,t,0);if(u>=Math.min(.85,c*Oy)+l)return 0;let d=a.soil(n,r);if(d<=.3)return 0;let f=a.gradient(n,r);if(f>=Dy)return 0;let p=a.height(n,r);if(p<this.water+.8)return 0;let m=a.flow(n,r);if(m>=ky)return 0;let h=(p-this.lo)/this.range,g=.66+.2*(tp(n/140,r/140,this.sLine)-.5);if(h>=g)return 0;let _=a.wetness(n,r),v=.55+.9*_,y=Y(.3,.55,d)*(1-Y(.3,Dy,f))*(1-Y(g-.14,g,h))*(1-Y(.6,ky,m)),b=Math.min(.85,c*v)*y,x=l*v*y,S=this.draw(e,t,1),C=this.draw(e,t,2),w=this.draw(e,t,3),T=this.draw(e,t,4),E=this.conifer(n,r,h,_);i.yaw=this.draw(e,t,5)*Math.PI*2;let D=.85+.3*T,O=(this.draw(e,t,6)-.5)*.16;if(u<b){let a=this.draw(e,t,7)<.03;i.variant=this.species(n,r,S<E,C,d,_,Y(.12,.55,b),a),this.draw(e,t,8)<.006+.02*Y(.2,.6,b)&&(i.variant=$.snag[S<E?0:1]),i.tint=this.crownTint(e,t,n,r,S<E,D,O);let o=Y(.35,.65,rp(n/170,r/170,this.sAge,2)),s=a?1.25:1;return i.layer=$.snag.includes(i.variant)?1:this.canopyLayer(e,t,S<E,Y(.12,.55,b)),i.scale=Math.min(Math.max((.62+.5*o)*(.6+.8*w**.8)*s*(1-.3*Y(g-.25,g,h)),Ay),jy),i.tint=Fy(i.tint,i.variant,i.scale,b),1}return u<b+x?(i.variant=C<.2+.5*E?$.juniper[0]:$.bush[0],i.scale=.6+w,i.layer=1,i.tint=Ny(D*(1+O),D,D*(1-O),1),2):0}species(e,t,n,r,i,a,o,s){let c,l;if(n){let e=.15+.7*(1-Y(.3,.7,i))*(1-a);c=r<e?$.pine:$.spruce,l=r<e?r/e:(r-e)/(1-e)}else{let n=.08+.4*a,o=(1-n)*.55*Y(.48,.6,rp(e/300,t/300,this.sBeech,2))*(1-a)*Y(.35,.6,i);c=r<n?$.birch:r<n+o?$.beech:$.oak,l=r<n?r/n:r<n+o?(r-n)/o:(r-n-o)/(1-n-o)}return c.length>2&&(s||l<My)?c[2]:(c.length>2?(l-My)/.84:l)<o?c[1]:c[0]}canopy(e,t,n,r,i){let a=this.f;i.density=0;let o=Y(.42,.57,rp(n/380,r/380,this.sStand,3)),s=Y(.62,.76,rp(n/85,r/85,this.sGlade,2)),c=(.03+.97*o)*(1-.88*s),l=a.soil(n,r);if(l<=.3||c<.01)return;let u=a.gradient(n,r),d=a.height(n,r),f=a.flow(n,r);if(u>=Dy||d<this.water+.8||f>=ky)return;let p=(d-this.lo)/this.range,m=.66+.2*(tp(n/140,r/140,this.sLine)-.5);if(p>=m)return;let h=a.wetness(n,r),g=Y(.3,.55,l)*(1-Y(.3,Dy,u))*(1-Y(m-.14,m,p))*(1-Y(.6,ky,f));i.density=Math.min(.85,c*(.55+.9*h))*g;let _=this.draw(e,t,1),v=this.draw(e,t,2),y=this.draw(e,t,3),b=this.draw(e,t,4),x=this.conifer(n,r,p,h),S=.85+.3*b,C=(this.draw(e,t,6)-.5)*.16;i.variant=this.species(n,r,_<x,v,l,h,Y(.12,.55,i.density),!1),i.tint=this.crownTint(e,t,n,r,_<x,S,C);let w=Y(.35,.65,rp(n/170,r/170,this.sAge,2)),T=_<x?1.05+.25*this.draw(e,t,17):1;i.scale=Math.min(Math.max((.62+.5*w)*(.6+.8*y**.8)*T*(1-.3*Y(m-.25,m,p)),Ay),jy)}crownTint(e,t,n,r,i,a,o){let s=rp(n/45,r/45,this.sAge+9,2)-.5,c=rp(n/60+31,r/60-17,this.sAge+21,2)-.5,l=a*(1+.8*s)*(i?.82+.3*this.draw(e,t,9):.72+.46*this.draw(e,t,9)),u=o*1.6+.5*c;return i?Ny(l*(1+.4*u),l,l*(1-.4*u),1):Ny(l*(1+u),l,l*(1-u),1)}canopyLayer(e,t,n,r){return(this.draw(e,t,16)<.28*r?.62:1)*(n?1.05+.25*this.draw(e,t,17):1)}rock(e,t,n,r,i){let a=this.f,o=.35+1.15*Y(.42,.62,rp(n/50,r/50,this.sClump,2)),s=this.draw(e,t,10);if(s>=.6*o||a.height(n,r)<this.water+.3)return!1;let c=a.flow(n,r);if(c>=.9)return!1;let l=Y(.27,.7,a.gradient(n,r)),u=1-Y(.22,.4,a.soil(n,r)),d=Y(.3,.55,c)*(1-Y(.8,.9,c));if(s>=Math.max(.5*l,.6*u,.35*d,.02)*o)return!1;let f=this.draw(e,t,11),p=Math.min(.3*(1-this.draw(e,t,12))**-.6,4),m=$.rock;i.variant=l>.5?f<.6?m[3]:m[0]:u>.5?f<.55?m[2]:m[0]:d>.4?f<.7?m[1]:m[2]:m[f<.35?0:f<.65?1:f<.85?2:3],i.scale=p,i.yaw=this.draw(e,t,13)*Math.PI*2;let h=.8+.4*this.draw(e,t,14),g=(this.draw(e,t,15)-.5)*.12;return i.tint=Ny(h*(1+g),h,h*(1-g),1),!0}},Ly=24*Math.SQRT2;function Ry(e,t,n,r,i){let a=new Float32Array(r*i).fill(1/0);for(let o of e){let e=Math.floor(o[0]/24)-t,s=Math.floor(o[2]/24)-n;e>=0&&s>=0&&e<r&&s<i&&(a[s*r+e]=0)}let o=(e,t,n,o,s,c)=>{let l=t+o,u=n+s;return l>=0&&u>=0&&l<r&&u<i?Math.min(a[e],a[u*r+l]+c):a[e]};for(let e=0;e<i;e++)for(let t=0;t<r;t++){let n=e*r+t;a[n]=o(n,t,e,-1,0,24),a[n]=o(n,t,e,-1,-1,Ly),a[n]=o(n,t,e,0,-1,24),a[n]=o(n,t,e,1,-1,Ly)}for(let e=i-1;e>=0;e--)for(let t=r-1;t>=0;t--){let n=e*r+t;a[n]=o(n,t,e,1,0,24),a[n]=o(n,t,e,1,1,Ly),a[n]=o(n,t,e,0,1,24),a[n]=o(n,t,e,-1,1,Ly)}return a}function zy(e,t,n,r,i){let a=e&&e.path.length>0?e.path:null,o=t[0],s=t[1],c=t[0],l=t[1];if(a){o=1/0,s=1/0,c=-1/0,l=-1/0;for(let e of a)o=Math.min(o,e[0]),c=Math.max(c,e[0]),s=Math.min(s,e[2]),l=Math.max(l,e[2])}let u=Math.floor(Math.max(o-n,r[0])/24),d=Math.floor(Math.max(s-n,r[1])/24),f=Math.max(Math.floor(Math.min(c+n,r[2])/24)-u+1,1),p=Math.max(Math.floor(Math.min(l+n,r[3])/24)-d+1,1),m;if(a)m=Ry(a,u,d,f,p);else{m=new Float32Array(f*p);for(let e=0;e<p;e++)for(let n=0;n<f;n++)m[e*f+n]=Math.hypot((u+n+.5)*24-t[0],(d+e+.5)*24-t[1])}let h=new Float32Array(f*p),g=0,_=new Int32Array(f*p);for(let e=0;e<p;e++)for(let t=0;t<f;t++){let r=e*f+t;m[r]>n||(h[r]=m[r]+24*J(u+t,d+e,i),_[g++]=r)}let v=_.slice(0,g).sort((e,t)=>h[e]-h[t]||e-t);return{i0:u,j0:d,nx:f,nz:p,dist:m,order:v}}var By=class{minX;minZ;cell;head;next;xs;zs;rs;gs;nx;nz;count=0;constructor(e,t,n,r,i,a){this.minX=e,this.minZ=t,this.cell=i,this.nx=Math.max(1,Math.ceil((n-e)/i)+1),this.nz=Math.max(1,Math.ceil((r-t)/i)+1),this.head=new Int32Array(this.nx*this.nz).fill(-1),this.next=new Int32Array(a),this.xs=new Float32Array(a),this.zs=new Float32Array(a),this.rs=new Float32Array(a),this.gs=new Uint8Array(a)}clampX(e){return Math.min(Math.max(Math.floor((e-this.minX)/this.cell),0),this.nx-1)}clampZ(e){return Math.min(Math.max(Math.floor((e-this.minZ)/this.cell),0),this.nz-1)}add(e,t,n,r){this.count===this.xs.length&&this.grow();let i=this.count++,a=this.clampZ(t)*this.nx+this.clampX(e);this.xs[i]=e,this.zs[i]=t,this.rs[i]=n,this.gs[i]=r,this.next[i]=this.head[a],this.head[a]=i}grow(){let e=this.xs.length*2+64,t=t=>{let n=new Float32Array(e);return n.set(t),n};this.xs=t(this.xs),this.zs=t(this.zs),this.rs=t(this.rs);let n=new Int32Array(e);n.set(this.next),this.next=n;let r=new Uint8Array(e);r.set(this.gs),this.gs=r}conflicts(e,t,n,r,i,a){let o=this.clampX(e),s=this.clampZ(t);for(let c=Math.max(s-1,0);c<=Math.min(s+1,this.nz-1);c++)for(let s=Math.max(o-1,0);s<=Math.min(o+1,this.nx-1);s++)for(let o=this.head[c*this.nx+s];o>=0;o=this.next[o]){let s=.5*(n+this.rs[o])*(this.gs[o]===r?i:a),c=this.xs[o]-e,l=this.zs[o]-t;if(c*c+l*l<s*s)return!0}return!1}overlaps(e,t,n,r){let i=this.clampX(e),a=this.clampZ(t);for(let o=Math.max(a-1,0);o<=Math.min(a+1,this.nz-1);o++)for(let a=Math.max(i-1,0);a<=Math.min(i+1,this.nx-1);a++)for(let i=this.head[o*this.nx+a];i>=0;i=this.next[i]){let a=n+this.rs[i]+r,o=this.xs[i]-e,s=this.zs[i]-t;if(o*o+s*s<a*a)return!0}return!1}},Vy=class{data;gx=0;gz=0;n;inv;ox;oz;constructor(e){this.data=e,this.n=e.resolution,this.inv=1/e.cellSize,this.ox=e.origin[0],this.oz=e.origin[1]}inside(e,t,n){let r=(this.n-1)*this.data.cellSize;return e>=this.ox+n&&t>=this.oz+n&&e<=this.ox+r-n&&t<=this.oz+r-n}bilinear(e,t,n){let r=this.n-1,i=Math.min(Math.max((t-this.ox)*this.inv,0),r-1e-4),a=Math.min(Math.max((n-this.oz)*this.inv,0),r-1e-4),o=Math.floor(i),s=Math.floor(a),c=i-o,l=a-s,u=s*this.n+o,d=e[u]+(e[u+1]-e[u])*c;return d+(e[u+this.n]+(e[u+this.n+1]-e[u+this.n])*c-d)*l}height(e,t){let n=this.n,r=n-1,i=this.data.height,a=Math.min(Math.max((e-this.ox)*this.inv,0),r-1e-4),o=Math.min(Math.max((t-this.oz)*this.inv,0),r-1e-4),s=Math.floor(a),c=Math.floor(o),l=a-s,u=o-c,d=c*n+s,f=i[d];return l>=u?f+(i[d+1]-f)*l+(i[d+n+1]-i[d+1])*u:f+(i[d+n+1]-i[d+n])*l+(i[d+n]-f)*u}soil(e,t){return this.bilinear(this.data.maps.soil,e,t)}flow(e,t){return this.bilinear(this.data.maps.flow,e,t)}wetness(e,t){return this.bilinear(this.data.maps.wetness,e,t)}gradient(e,t){let n=this.data.cellSize;return this.gx=(this.height(e+n,t)-this.height(e-n,t))/(2*n),this.gz=(this.height(e,t+n)-this.height(e,t-n))/(2*n),Math.hypot(this.gx,this.gz)}},Hy={plants:4e4,rocks:4e3},Uy={low:{plants:16e3,rocks:2e3},medium:{plants:22e3,rocks:2600},high:{plants:3e4,rocks:3200},ultra:Hy,extreme:Hy},Wy=1e3,Gy=e=>O(e.seed,32366),Ky=e=>O(e.seed,32366,23)|0,qy=4e3,Jy=3.5,Yy=115,Xy=3,Zy=4,Qy=24/Xy,$y=24/Zy,eb=.55,tb=.05,nb=70,rb=.3,ib=2155905152,ab=.5;function ob(e){return{count:0,pos:new Float32Array(e*3),scale:new Float32Array(e),yaw:new Float32Array(e),variant:new Uint8Array(e),tint:new Uint32Array(e),nrm:new Uint32Array(e),pathDist:new Float32Array(e)}}function sb(e,t){return{count:t,pos:e.pos.slice(0,t*3),scale:e.scale.slice(0,t),yaw:e.yaw.slice(0,t),variant:e.variant.slice(0,t),tint:e.tint.slice(0,t),nrm:e.nrm.slice(0,t),pathDist:e.pathDist.slice(0,t)}}var cb=e=>Math.round(Math.min(Math.max(e,-1),1)*32767)&65535;function lb(e,t){let n=1/Math.hypot(e,t,1);return(cb(-e*n)|cb(-t*n)<<16)>>>0}function ub(e,t,n,r,i,a,o){let s=e.count++;e.pos[s*3]=t,e.pos[s*3+1]=n,e.pos[s*3+2]=r,e.scale[s]=i.scale,e.yaw[s]=i.yaw,e.variant[s]=i.variant,e.tint[s]=i.tint,e.nrm[s]=a,e.pathDist[s]=o}function db(e,t,n,r,i){let a=new By(t,n,r,i,32,64);if(!e)return a;for(let t of e.gates)if(a.add(t.pos[0],t.pos[2],.5*Math.hypot(t.width,t.height)+2,0),t.kind===`tunnel`)for(let e of _(t))a.add(e.x,e.z,e.r,0);for(let t of e.obstacles)for(let e of f(t))a.add(e.x,e.z,e.r,0);return a.add(e.start.pos[0],e.start.pos[2],8,0),a}var fb=null;function pb(){return fb??={crown:Q.map((e,t)=>rv(t)?.crown??0),rockHeight:Q.map(e=>e.rock>=0?_p()[e.rock].height:0),trunk:Q.map((e,t)=>rv(t)?.trunk??0),top:Q.map((e,t)=>rv(t)?.top??0)},fb}var mb=class{terrain;track;region;fields;rules;blockers;rockHash;plantHash;index;pick={variant:0,scale:1,yaw:0,tint:0};tables=pb();sJit;sPerm;obstacleTrees=0;ring=new Float32Array;constructor(e,t,n){this.terrain=e,this.track=t,this.region=n;let r=Gy(e);this.fields=new Vy(e),this.rules=new Iy(this.fields,r),this.sJit=O(r,21)|0,this.sPerm=O(r,22)|0;let i=(e.resolution-1)*e.cellSize,[a,o]=e.origin;this.blockers=db(t,a,o,a+i,o+i),this.rockHash=new By(a,o,a+i,o+i,6,4096),this.plantHash=new By(a,o,a+i,o+i,9,8192),this.index=t&&t.path.length>0?new re(t.path):null}pathDistance(e,t,n){return!this.index||n>Yy?1/0:(this.index.nearestXZ(e,t),this.index.lastDist)}rockBase(e,t,n,r,i){let a=this.fields,o=n*.7;return Math.min(a.height(e,t),a.height(e+o,t),a.height(e-o,t),a.height(e,t+o),a.height(e,t-o))-r*i*n}placeRocks(e){let t=ob(e),n=this.region,r=this.pick,i=this.fields;for(let a of n.order){if(t.count>=e)break;let o=n.i0+a%n.nx,s=n.j0+Math.floor(a/n.nx),c=n.dist[a],l=$y*$y,u=Math.floor(J(o,s,this.sPerm+1)*l);for(let n=0;n<l&&t.count<e;n++){let e=(n*7+u)%l,a=o*$y+e%$y,d=s*$y+Math.floor(e/$y),f=(a+.1+.8*J(a,d,this.sJit+1))*Zy,p=(d+.1+.8*J(a,d,this.sJit+2))*Zy;if(!i.inside(f,p,6)||!this.rules.rock(a,d,f,p,r))continue;let m=r.scale;if(this.track?.parkMap&&Math.hypot(f,p)<this.track.parkMap.radius+m)continue;let h=this.pathDistance(f,p,c);if(h<Jy+m||this.blockers.overlaps(f,p,m,.5)||this.rockHash.conflicts(f,p,m,0,1.3,1.3))continue;let g=lb(i.gx,i.gz),_=.15+.25*J(a,d,this.sJit+3);ub(t,f,this.rockBase(f,p,m,_,this.tables.rockHeight[r.variant]),p,r,g,h),this.rockHash.add(f,p,m,0)}}return sb(t,t.count)}placeObstacleTrees(e){let t=this.fields,n=this.tables,r=[...$.spruce,...$.pine,...$.oak,...$.birch];this.track?.obstacles.forEach((i,a)=>{if(i.kind!==`tree`)return;let[o,,s]=i.pos,c=i.size[0],l=i.size[1],u=(t.height(o,s)-t.data.minHeight)/Math.max(t.data.maxHeight-t.data.minHeight,1),d=this.rules.conifer(o,s,u,t.wetness(o,s)),f=r[0],p=1/0,m=1;for(let e of r){let t=c/n.trunk[e],r=l/n.top[e],i=+(tv(e)?.foliage===H.needle),o=Math.abs(Math.log(t/r))+.8*Math.abs(i-d)+.3*J(a,e,this.sJit);o<p&&(p=o,f=e,m=Math.sqrt(t*r))}let h=Math.min(Math.max(m,Ay),jy*1.15);t.gradient(o,s),ub(e,o,t.height(o,s)-.05*h,s,{variant:f,scale:h,yaw:i.yaw,tint:ib},lb(t.gx,t.gz),this.pathDistance(o,s,0)),this.plantHash.add(o,s,Q[f].spacing*h,0),this.obstacleTrees++})}placePlants(e){let t=ob(e),n=this.region,r=this.pick,i=this.fields,a=Qy*Qy,o=new Float32Array(e);this.placeObstacleTrees(t);for(let s of n.order){if(t.count>=e)break;let c=n.i0+s%n.nx,l=n.j0+Math.floor(s/n.nx),u=n.dist[s],d=Math.floor(J(c,l,this.sPerm)*a);for(let n=0;n<a&&t.count<e;n++){let e=(n*37+d)%a,s=c*Qy+e%Qy,f=l*Qy+Math.floor(e/Qy),p=(s+.1+.8*J(s,f,this.sJit))*Xy,m=(f+.1+.8*J(s,f,this.sJit+7))*Xy;if(!i.inside(p,m,6)||this.track?.parkMap&&Math.hypot(p,m)<this.track.parkMap.radius+10)continue;let h=this.rules.plant(s,f,p,m,r);if(h===0)continue;let g=this.pathDistance(p,m,u);if(g<6.5||g<nb&&J(s,f,this.sJit+9)>=eb+.44999999999999996*Y(6.5,nb,g))continue;let _=r.scale,v=Q[r.variant],y=h-1;if(this.blockers.overlaps(p,m,.8*this.tables.crown[r.variant]*_,1)||this.rockHash.overlaps(p,m,y===0?rb:ab,.3)||this.plantHash.conflicts(p,m,v.spacing*_,y,1,.6))continue;let b=lb(i.gx,i.gz);if(o[t.count]=u,y===0&&g>65&&(r.scale=Math.min(Math.max(_*(r.layer??1),Ay),jy),!$.snag.includes(r.variant)&&J(s,f,this.sJit+11)<tb)){let e=$.snag[tv(r.variant)?.foliage===H.needle?0:1];Q[e].spacing<=v.spacing&&(r.variant=e,r.scale=_)}ub(t,p,i.height(p,m)-.05*r.scale,m,r,b,g),this.plantHash.add(p,m,v.spacing*_,y)}}return this.ring=o.slice(0,t.count),sb(t,t.count)}};function hb(e,t,n){let r=_b(e,t,n),i=gb.find(e=>e.key===r);if(i)return i.place;let a=vb(e,t,n);return gb.unshift({key:r,place:a}),gb.length=Math.min(gb.length,3),a}var gb=[];function _b(e,t,n){let r=[],i=e=>{let t=new Uint8Array(e.buffer,e.byteOffset,e.byteLength),n=new Uint32Array(e.buffer,e.byteOffset,e.byteLength>>2),r=2166136261,i=2538058380;for(let e=0;e<n.length;e++)r=Math.imul(r^n[e],16777619)>>>0,i=Math.imul(i^n[e],16777623)>>>0;for(let e=n.length*4;e<t.length;e++)r=Math.imul(r^t[e],16777619)>>>0;return`${e.constructor.name}:${e.byteLength}:${r}:${i}`};return`${JSON.stringify(e,(e,t)=>ArrayBuffer.isView(t)?(r.push(i(t)),`#${r.length-1}`):t)}|${r.join(`,`)}|${JSON.stringify([n,t],(e,t)=>ArrayBuffer.isView(t)?i(t):t)}`}function vb(e,t,n){let r=(e.resolution-1)*e.cellSize,[i,a]=e.origin,o=new mb(e,t,zy(t,[i+r/2,a+r/2],Wy,[i,a,i+r,a+r],Ky(e))),s=o.placeRocks(qy),c=o.placePlants(n.plants),l=n.rocks<s.count?sb(s,n.rocks):s,u=0;for(let e=0;e<c.count;e++)Q[c.variant[e]].group===`tree`&&u++;return{plants:c,rocks:l,trees:u,bushes:c.count-u,obstacleTrees:o.obstacleTrees,plantRing:o.ring}}var yb=2,bb=.03,xb=.2;function Sb(e){let t=tv(e)?.species;return t===`spruce`?0:t===`pine`?1:t===`birch`?3:2}function Cb(){let e={};return[$.spruce,$.pine,[...$.oak,...$.beech],$.birch].forEach((t,n)=>{let r=e=>t.reduce((t,n)=>t+e(Q[n]),0)/t.length;e[`TONE${n}`]=[r(e=>e.tone[0]),r(e=>e.tone[1]),r(e=>e.tone[2]),r(e=>e.translucency)].map(e=>e.toFixed(4)).join(`, `)}),e}var wb=(e,t,n)=>(e|t-1<<3|(n&65535)<<5)>>>0;function Tb(e,t,n){let r=new Vy(e),i=new Iy(r,Gy(e)),a=(e.resolution-1)*e.cellSize,[o,s]=e.origin,c=zy(t,[o+a/2,s+a/2],n.radius,[o,s,o+a,s+a],Ky(e)),l=new Uint32Array(n.cap*8),u=new Float32Array(l.buffer),d={density:0,variant:0,scale:1,tint:0},f=0,p=0;for(let e of c.order){if(f>=n.cap)break;let a=c.i0+e%c.nx,o=c.j0+Math.floor(e/c.nx),s=c.dist[e]>n.coveredRing;for(let e=0;e<yb*yb&&f<n.cap;e++){let c=a*yb+e%yb,m=o*yb+Math.floor(e/yb),h=(c+.15+.7*J(c,m,31))*12,g=(m+.15+.7*J(c,m,32))*12;if(!r.inside(h,g,6)||t?.parkMap&&Math.hypot(h,g)<t.parkMap.radius+20||(i.canopy(c,m,h,g,d),d.density<bb))continue;let _=Y(bb,xb,d.density);if(J(c,m,33)>=_)continue;let v=1+ +(d.density>.12)+ +(d.density>.35),y=Q[d.variant],b=f++*8;u[b]=h,u[b+1]=r.height(h,g),u[b+2]=g,u[b+3]=y.height*d.scale*(tv(d.variant)?.species===`oak`?.85:1),u[b+4]=12*(1.05+.4*J(c,m,34)),l[b+5]=d.tint,u[b+6]=s?n.uncoveredNear:0,l[b+7]=wb(Sb(d.variant),v,Math.floor(J(c,m,35)*65536)),s&&p++}}return{count:f,words:l.subarray(0,f*8),uncovered:p}}var Eb=class{layout;pipeline;ready;constructor(e){let t=e.device;this.layout=t.createBindGroupLayout({label:`far-canopy`,entries:[{binding:0,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:`uniform`}},{binding:1,visibility:GPUShaderStage.VERTEX,buffer:{type:`read-only-storage`}}]});let n=e.module(`vegetation/veg_far.wgsl`,Cb());this.ready=t.createRenderPipelineAsync({label:`far-canopy`,layout:t.createPipelineLayout({bindGroupLayouts:[e.frame.layout,e.world.layout,this.layout]}),vertex:{module:n,entryPoint:`vs`},fragment:{module:n,entryPoint:`fs`,targets:It},primitive:{topology:`triangle-strip`,cullMode:`none`},depthStencil:Lt}).then(e=>{this.pipeline=e})}},Db=class{cards;bytes;buffer;group;pipeline;constructor(e,t,n,r){if(this.cards=r.count,this.bytes=r.count*32,r.count===0){this.buffer=null,this.group=null,this.pipeline=null;return}let i=e.device;this.buffer=i.createBuffer({label:`far-canopy-cards`,size:this.bytes,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}),i.queue.writeBuffer(this.buffer,0,r.words.buffer,r.words.byteOffset,this.bytes),this.group=i.createBindGroup({label:`far-canopy`,layout:t.layout,entries:[{binding:0,resource:{buffer:n}},{binding:1,resource:{buffer:this.buffer}}]}),this.pipeline=t.pipeline}encodeGBuffer(e){this.pipeline&&this.group&&(e.setPipeline(this.pipeline),e.setBindGroup(2,this.group),e.draw(4,this.cards))}destroy(){this.buffer?.destroy()}},Ob=201326592,kb=1,Ab=-1e9;function jb(e){return e*Math.min(6,Math.max(3,7-e/250))}var Mb=7,Nb=120;function Pb(e,t,n){let r=Math.min(1,(t/Math.max(e,.001))**2),i=Math.min(1,Math.max(0,(e-.72*n)/(.28*n)));return r*(1-i*i*(3-2*i))}function Fb(e,t,n,r,i){let a=(t-e)/96,o=0;for(let t=0;t<96;t++){let s=e+(t+.5)*a;o+=2*Math.PI*s*a*n*Pb(s,r,i)}return o}var Ib=(e,t)=>Math.ceil(e/t)*t;function Lb(e,t=Ob){let n=e.grassDistance,r=Math.min(.125*n,Mb),i=Math.min(n,Nb),a=Math.max(4,.09*i),o=Math.max(12,.28*i),s=jb(e.grassBladesPerM2),c=[0,a,o,n],l=[0,1,2].map(e=>Ib(kb*Fb(c[e],c[e+1],s,r,n)+4096,64)),u=l[0]+l[1]+l[2],d=Math.floor(Math.min(t,Ob)/32/64)*64;u>d&&(l=l.map(e=>Math.max(64,Math.floor(e*d/u/64)*64)));let f=Math.ceil(2*n/4)+3,p=s*4*4,m=l[0],h=l[1],g=l[2];return{patchSize:4,cellsPerSide:f,slotsPerPatch:p,fullRadius:r,distance:n,lodDistance:[a,o],caps:[m,h,g],chunkCap:Math.ceil(Fb(0,n,s,r,n)/64)+f*f,offsets:[0,m*32,(m+h)*32],bladeBytes:(m+h+g)*32}}var Rb=Ut({low:{lodScale:.6,maxDistance:700,minPixels:1.5,leafDetail:0},medium:{lodScale:.8,maxDistance:1100,minPixels:1.5,leafDetail:0},high:{lodScale:1,maxDistance:1600,minPixels:1.5,leafDetail:0},ultra:{lodScale:1,maxDistance:2400,minPixels:1.5,leafDetail:0}},{lodScale:1.5,maxDistance:4e3,minPixels:.5,leafDetail:1}),zb=Ut({low:{cards:14e3},medium:{cards:3e4},high:{cards:5e4},ultra:{cards:7e4}},{cards:16e4});function Bb(){let e=new ArrayBuffer(160);return{f32:new Float32Array(e),i32:new Int32Array(e),u32:new Uint32Array(e)}}function Vb(e,t){let{f32:n,i32:r,u32:i}=e,a=t.budget,o=Math.hypot(t.windDir[0],t.windDir[1]);n[0]=o>1e-6?t.windDir[0]/o:1,n[1]=o>1e-6?t.windDir[1]/o:0,n[2]=t.windSpeed,n[3]=t.parkRadius??0,t.quad?(n[4]=t.quad.pos[0],n[5]=t.quad.pos[1],n[6]=t.quad.pos[2],n[7]=t.quad.thrust,n[8]=t.quad.vel[0],n[9]=t.quad.vel[1],n[10]=t.quad.vel[2]):(n[4]=0,n[5]=Ab,n[6]=0,n[7]=0,n[8]=0,n[9]=0,n[10]=0),n[11]=0,n[12]=a.patchSize,n[13]=a.distance,n[14]=a.fullRadius,n[15]=a.slotsPerPatch/(a.patchSize*a.patchSize),n[16]=a.lodDistance[0],n[17]=a.lodDistance[1],n[18]=Number.isFinite(t.waterLevel)?t.waterLevel:-1e9,n[19]=a.slotsPerPatch;let s=a.cellsPerSide*a.patchSize/2;r[20]=Math.floor((t.cameraXZ[0]-s)/a.patchSize),r[21]=Math.floor((t.cameraXZ[1]-s)/a.patchSize),r[22]=a.cellsPerSide,r[23]=t.seed|0,i[24]=a.caps[0],i[25]=a.caps[1],i[26]=a.caps[2],i[27]=a.chunkCap,n[28]=t.tree.lodScale,n[29]=t.tree.maxDistance,n[30]=t.tree.minPixels,n[31]=t.tree.leafDetail,i[32]=t.tree.slots,i[33]=t.tree.draws,i[34]=0,i[35]=0,n[36]=t.farDistance,n[37]=0,n[38]=0,n[39]=0}var Hb=32,Ub=[{nseg:7,tip:!0},{nseg:3,tip:!0},{nseg:1,tip:!1}],Wb=class{genLayout;finLayout;drawLayout;patchesPipe;bladesPipe;finDispatchPipe;finDrawPipe;drawPipes=[];ready;cover;device;constructor(e){let t=e.device,n=GPUShaderStage.COMPUTE,r=(e,t=`storage`)=>({binding:e,visibility:n,buffer:{type:t}}),i={binding:0,visibility:n,buffer:{type:`uniform`}};this.device=t,this.cover=t.createTexture({label:`grass-ground-cover`,size:[xf,xf],format:`rgba8unorm`,usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST}),this.genLayout=t.createBindGroupLayout({label:`grass-gen`,entries:[i,r(1),r(2),r(3),{binding:4,visibility:n,texture:{sampleType:`float`}}]}),this.finLayout=t.createBindGroupLayout({label:`grass-fin`,entries:[i,r(1),r(2),r(3)]});let a=GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT;this.drawLayout=t.createBindGroupLayout({label:`grass-draw`,entries:[{binding:0,visibility:a,buffer:{type:`uniform`}},{binding:1,visibility:GPUShaderStage.VERTEX,buffer:{type:`read-only-storage`}}]});let o=n=>t.createPipelineLayout({bindGroupLayouts:[e.frame.layout,e.world.layout,n]}),s=o(this.genLayout),c=o(this.finLayout),l=o(this.drawLayout),u=e.module(`vegetation/grass_cull.wgsl`),d=e.module(`vegetation/grass_finalize.wgsl`),f=(e,n,r,i)=>t.createComputePipelineAsync({label:e,layout:n,compute:{module:r,entryPoint:i}}),p=[0,1,2].map(n=>{let r=e.module(`vegetation/grass.wgsl`,{NSEG:Ub[n].nseg,HAS_TIP:Ub[n].tip});return t.createRenderPipelineAsync({label:`grass-lod${n}`,layout:l,vertex:{module:r,entryPoint:`vs`},fragment:{module:r,entryPoint:`fs`,targets:It},primitive:{topology:`triangle-strip`,cullMode:`none`},depthStencil:Lt})});this.ready=Promise.all([f(`grass-patches`,s,u,`patches`),f(`grass-blades`,s,u,`blades_main`),f(`grass-fin-dispatch`,c,d,`fin_dispatch`),f(`grass-fin-draw`,c,d,`fin_draw`),Promise.all(p)]).then(([e,t,n,r,i])=>{this.patchesPipe=e,this.bladesPipe=t,this.finDispatchPipe=n,this.finDrawPipe=r,this.drawPipes=i})}setCover(e){let t=e??new Uint8Array(4194304);this.device.queue.writeTexture({texture:this.cover},t,{bytesPerRow:xf*4},[xf,xf])}},Gb=class{pipes;budget;device;counters;chunks;blades;dispatchArgs;drawArgs;genGroup;finGroup;drawGroups=[];staging;copyQueued=!1;mapping=!1;sinceSample=0;counts={lod:[0,0,0],patches:0,chunks:0};sampled=!1;constructor(e,t,n,r){this.pipes=t;let i=e.device;this.device=i;let a=Math.min(i.limits.maxStorageBufferBindingSize,i.limits.maxBufferSize);this.budget=Lb(e.quality,a);let o=this.budget,s=GPUBufferUsage.STORAGE;this.counters=i.createBuffer({label:`grass-counters`,size:Hb,usage:s|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST}),this.chunks=i.createBuffer({label:`grass-chunks`,size:o.chunkCap*16,usage:s}),this.blades=i.createBuffer({label:`grass-blades`,size:o.bladeBytes,usage:s}),this.dispatchArgs=i.createBuffer({label:`grass-dispatch-args`,size:16,usage:s|GPUBufferUsage.INDIRECT}),this.drawArgs=i.createBuffer({label:`grass-draw-args`,size:48,usage:s|GPUBufferUsage.INDIRECT}),this.staging=r?i.createBuffer({label:`grass-counter-readback`,size:Hb,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST}):null,this.genGroup=i.createBindGroup({label:`grass-gen`,layout:t.genLayout,entries:[{binding:0,resource:{buffer:n}},{binding:1,resource:{buffer:this.counters}},{binding:2,resource:{buffer:this.chunks}},{binding:3,resource:{buffer:this.blades}},{binding:4,resource:t.cover.createView()}]}),this.finGroup=i.createBindGroup({label:`grass-fin`,layout:t.finLayout,entries:[{binding:0,resource:{buffer:n}},{binding:1,resource:{buffer:this.counters}},{binding:2,resource:{buffer:this.dispatchArgs}},{binding:3,resource:{buffer:this.drawArgs}}]});for(let e=0;e<3;e++)this.drawGroups.push(i.createBindGroup({label:`grass-draw-lod${e}`,layout:t.drawLayout,entries:[{binding:0,resource:{buffer:n}},{binding:1,resource:{buffer:this.blades,offset:o.offsets[e],size:o.caps[e]*32}}]}))}pollReadback(){let e=this.staging;e&&this.copyQueued&&!this.mapping&&(this.copyQueued=!1,this.mapping=!0,e.mapAsync(GPUMapMode.READ).then(()=>{let t=new Uint32Array(e.getMappedRange().slice(0));e.unmap(),this.counts.chunks=t[0],this.counts.lod[0]=t[1],this.counts.lod[1]=t[2],this.counts.lod[2]=t[3],this.counts.patches=t[4],this.sampled=!0,this.mapping=!1},()=>{this.mapping=!1}))}encodePre(e,t){this.clearCounters(e);let n=e.beginComputePass({label:`grass-cull`});this.encodeCull(n,t),n.end(),this.copyCounters(e)}clearCounters(e){e.clearBuffer(this.counters)}encodeCull(e,t){let n=this.budget;e.setBindGroup(0,t.frame.group),e.setBindGroup(1,t.world.group),e.setPipeline(this.pipes.patchesPipe),e.setBindGroup(2,this.genGroup),e.dispatchWorkgroups(Math.ceil(n.cellsPerSide*n.cellsPerSide/64)),e.setPipeline(this.pipes.finDispatchPipe),e.setBindGroup(2,this.finGroup),e.dispatchWorkgroups(1),e.setPipeline(this.pipes.bladesPipe),e.setBindGroup(2,this.genGroup),e.dispatchWorkgroupsIndirect(this.dispatchArgs,0),e.setPipeline(this.pipes.finDrawPipe),e.setBindGroup(2,this.finGroup),e.dispatchWorkgroups(1)}copyCounters(e){this.staging&&!this.copyQueued&&!this.mapping&&++this.sinceSample>=30&&(this.sinceSample=0,e.copyBufferToBuffer(this.counters,0,this.staging,0,Hb),this.copyQueued=!0)}encodeGBuffer(e){for(let t=0;t<3;t++)e.setPipeline(this.pipes.drawPipes[t]),e.setBindGroup(2,this.drawGroups[t]),e.drawIndirect(this.drawArgs,t*16)}destroy(){for(let e of[this.counters,this.chunks,this.blades,this.dispatchArgs,this.drawArgs,this.staging])e?.destroy()}},Kb=8,qb=20,Jb=e=>e===`tree`?0:e===`bush`?1:2;function Yb(e,t){let n=new Uint32Array(22);for(let t of e)for(let e=0;e<t.count;e++)n[t.set.variant[e]]++;let r=new Uint32Array(22),i=0;for(let e=0;e<22;e++)r[e]=i,i+=Math.ceil(n[e]/64)*64;let a=new ArrayBuffer(Math.max(i,64)*32),o=new Float32Array(a),s=new Uint32Array(a),c=new Uint32Array(22),l=[];for(let t of e){let e=t.set,n=new Uint32Array(t.count);l.push(n);for(let i=0;i<t.count;i++){let t=e.variant[i],a=r[t]+c[t]++,l=a*Kb;n[i]=a,o[l]=e.pos[i*3],o[l+1]=e.pos[i*3+1],o[l+2]=e.pos[i*3+2],o[l+3]=e.scale[i],o[l+4]=e.yaw[i],s[l+5]=t,s[l+6]=e.tint[i],s[l+7]=e.nrm[i]}}let u=new ArrayBuffer(1760),d=new Float32Array(u),f=new Uint32Array(u);for(let e=0;e<22;e++){let i=t[e],a=i.def,o=e*qb;f[o]=r[e],f[o+1]=n[e],f[o+2]=Jb(a.group),d[o+4]=i.centreY,d[o+5]=i.radius,d[o+6]=a.lodRatio[0],d[o+7]=a.lodRatio[1],d[o+8]=i.height,d[o+9]=a.swayHz,d[o+10]=a.swayStrength,d[o+11]=a.flutter,d[o+12]=a.tone[0],d[o+13]=a.tone[1],d[o+14]=a.tone[2],d[o+15]=a.translucency;let s=tv(e);s&&(d[o+16]=s.crownC[1],d[o+17]=s.crownR[0],d[o+18]=s.crownR[1],d[o+19]=s.crownR[2])}return{slots:i,instances:a,variants:u,first:r,count:n,runSlots:l}}function Xb(e){let t=Uy[e.tier];return{grassBladesPerM2:e.grassBladesPerM2,grassDistance:e.grassDistance,plants:t.plants,rocks:t.rocks,farCards:zb[e.tier].cards,farDistance:e.terrainViewDistance}}function Zb(e,t){if(!e)return{grass:!0,trees:!0,far:!0};let n=e.plants!==t.plants||e.rocks!==t.rocks;return{grass:e.grassBladesPerM2!==t.grassBladesPerM2||e.grassDistance!==t.grassDistance,trees:n,far:e.plants!==t.plants||e.farCards!==t.farCards||e.farDistance!==t.farDistance}}var Qb=.7;function $b(e,t,n,r){let i=e*374761393+t*668265263+n*2147483647+r*1274126177|0;return i=Math.imul(i^i>>>13,1274126177),i^=i>>>16,(i>>>0)/4294967296}var ex=e=>e*e*e*(e*(e*6-15)+10),tx=(e,t)=>(e%t+t)%t,nx=(e,t,n)=>e+(t-e)*n;function rx(e,t){let n=new Float32Array(e*e*e*3);for(let r=0;r<e;r++)for(let i=0;i<e;i++)for(let a=0;a<e;a++){let o=((r*e+i)*e+a)*3;for(let e=0;e<3;e++)n[o+e]=$b(a,i,r,t+e)}return n}function ix(e,t,n,r,i){let a=Math.floor(n),o=Math.floor(r),s=Math.floor(i),c=n-a,l=r-o,u=i-s,d=(n,r,i)=>{let d=((tx(s+i,t)*t+tx(o+r,t))*t+tx(a+n,t))*3;return(e[d]*2-1)*(c-n)+(e[d+1]*2-1)*(l-r)+(e[d+2]*2-1)*(u-i)},f=ex(c),p=ex(l),m=ex(u),h=nx(d(0,0,0),d(1,0,0),f),g=nx(d(0,1,0),d(1,1,0),f),_=nx(d(0,0,1),d(1,0,1),f),v=nx(d(0,1,1),d(1,1,1),f);return 1.6*nx(nx(h,g,p),nx(_,v,p),m)}function ax(e,t,n,r,i){let a=Math.floor(n),o=Math.floor(r),s=Math.floor(i),c=1/0,l=1/0;for(let u=-1;u<=1;u++)for(let d=-1;d<=1;d++)for(let f=-1;f<=1;f++){let p=((tx(s+u,t)*t+tx(o+d,t))*t+tx(a+f,t))*3,m=a+f+.15+.7*e[p]-n,h=o+d+.15+.7*e[p+1]-r,g=s+u+.15+.7*e[p+2]-i,_=m*m+h*h+g*g;_<c?(l=c,c=_):_<l&&(l=_)}return Math.sqrt(l)-Math.sqrt(c)}var ox=e=>Math.round(Math.min(Math.max(e,0),1)*255);function*sx(){let e=new Uint8Array(8388608),t=rx(16,11),n=rx(16,23),r=rx(16,37),i=rx(16,53);for(let a=0;a<128;a++){for(let o=0;o<128;o++)for(let s=0;s<128;s++){let c=((a*128+o)*128+s)*4,l=(s+.5)/128*16,u=(o+.5)/128*16,d=(a+.5)/128*16;e[c]=ox(.5+.4*ix(t,16,l,u,d)),e[c+1]=ox(.5+.4*ix(n,16,l,u,d)),e[c+2]=ox(.5+.4*ix(r,16,l,u,d)),e[c+3]=ox(ax(i,16,l,u,d)/Qb)}yield}return e}var cx=null;function lx(e=8){return cx??=yp(sx(),e),cx.catch(()=>{cx=null}),cx}var ux=`./textures/bark/bark.bin`,dx=[`pine-plates`,`pine-flakes`,`oak`,`spruce`,`beech`,`birch-paper`];function fx(e){return e===`low`||e===`medium`?null:+(e===`high`)}function px(e){let t=new DataView(e);if(e.byteLength<8||new TextDecoder().decode(new Uint8Array(e,0,4))!==`BRK1`)throw Error(`bark.bin: bad magic`);let n=t.getUint32(4,!0),r=JSON.parse(new TextDecoder().decode(new Uint8Array(e,8,n)));if(r.layers.length!==dx.length||r.layers.some((e,t)=>e.name!==dx[t]))throw Error(`bark.bin: unexpected layers`);let i=8+n,a={colour:[],surface:[]};for(let t of[`colour`,`surface`])for(let n=0;n<r.mips;n++){let o=Math.max(r.size>>n,4),s=o/4*(o/4)*16*r.layers.length;if(i+s>e.byteLength)throw Error(`bark.bin: truncated`);a[t].push(new Uint8Array(e,i,s)),i+=s}return{size:r.size,mips:r.mips,layers:r.layers,blocks:a}}async function mx(e=ux){try{let t=await fetch(e);return t.ok?px(await t.arrayBuffer()):null}catch{return null}}function hx(e,t,n){let r=t.layers.length,i=t.size>>n,a=t.mips-n,o=(o,s)=>{let c=e.createTexture({label:`bark-scans-${o}`,size:[i,i,r],mipLevelCount:a,format:s,dimension:`2d`,usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});for(let s=0;s<a;s++){let a=Math.max(i>>s,4),l=a/4;e.queue.writeTexture({texture:c,mipLevel:s},t.blocks[o][s+n],{bytesPerRow:l*16,rowsPerImage:l},[a,a,r])}return c};return{colour:o(`colour`,`bc7-rgba-unorm-srgb`),surface:o(`surface`,`bc7-rgba-unorm`)}}function gx(e){let t=e.flatMap(e=>e.lods),n=[],r=new Float64Array(1+e.length*3+t.length*2),i=0;r[i++]=e.length;for(let t of e)r[i++]=t.height,r[i++]=t.centreY,r[i++]=t.radius;for(let e of t)r[i++]=e.vertexCount,r[i++]=e.idx.length;n.push(r);for(let e of t)n.push(e.pos,e.nrm,e.uv,e.attr,e.idx);let a=n.reduce((e,t)=>e+Math.ceil(t.byteLength/4)*4,0),o=new Uint8Array(a),s=0;for(let e of n)o.set(new Uint8Array(e.buffer,e.byteOffset,e.byteLength),s),s+=Math.ceil(e.byteLength/4)*4;return o.buffer}function _x(e,t=Q){let n=new Float64Array(e,0,1)[0];if(n!==t.length)return null;let r=new Float64Array(e,0,1+n*3+n*3*2),i=r.byteLength,a=1+n*3,o=(t,n,r)=>{let a=t(e,i,n);return i+=Math.ceil(n*r/4)*4,a},s=[];for(let e=0;e<n*3;e++){let e=r[a++],t=r[a++];s.push({vertexCount:e,pos:o((e,t,n)=>new Float32Array(e,t,n),e*3,4),nrm:o((e,t,n)=>new Float32Array(e,t,n),e*3,4),uv:o((e,t,n)=>new Float32Array(e,t,n),e*2,4),attr:o((e,t,n)=>new Uint8Array(e,t,n),e*4,1),idx:o((e,t,n)=>new Uint32Array(e,t,n),t,4)})}return i===e.byteLength?t.map((e,t)=>({def:e,lods:[s[t*3],s[t*3+1],s[t*3+2]],height:r[1+t*3],centreY:r[2+t*3],radius:r[3+t*3]})):null}async function vx(e,t){if(typeof Worker>`u`||typeof navigator>`u`)return null;let n=Q.map((e,n)=>e.rock<0&&(!t||t.includes(n))?n:-1).filter(e=>e>=0),r=Math.max(1,Math.min(n.length,(navigator.hardwareConcurrency||4)-1)),i=Array.from({length:r},()=>[]);n.forEach((e,t)=>i[t%r].push(e));let a=Q.map(()=>null);try{await Promise.all(i.map(t=>new Promise((n,r)=>{let i=new Worker(new URL(new URL(`treeBuild.worker-oaikfMLh.js`,import.meta.url).href,``+import.meta.url),{type:`module`});i.onmessage=e=>{let t=_x(e.data.buffer,e.data.variants.map(e=>Q[e]));if(i.terminate(),!t){r(Error(`tree build worker returned a malformed buffer`));return}e.data.variants.forEach((e,n)=>{a[e]=t[n]}),n()},i.onerror=e=>{i.terminate(),r(e)},i.postMessage({dense:e,variants:t})})))}catch{return null}return a}var yx=`import { runSliced, runSync, type Steps } from './slices';

/**
 * The bark shader's noise, baked once into a tileable 3D texture so a bark pixel costs a few filtered texture reads instead of dozens of
 * hashes. BARK_NOISE_SIZE texels a side and CELLS noise cells across (8 texels a cell, so the hardware's linear filter between texels follows
 * the smooth noise closely). Four channels, mirrored by tree_bark.wgsl:
 *   r, g, b: three independent gradient noises, stored as 0.5 + 0.4 * n (n in about [-1.25, 1.25]);
 *   a:       cellular noise: the gap between the nearest and second-nearest feature point (0 on a cell border), stored as gap / CELL_GAP_RANGE.
 * Every channel wraps at the texture edge, so the shader samples it with a repeating sampler.
 */
export const BARK_NOISE_SIZE = 128;
export const CELLS = 16;
const CELL_GAP_RANGE = 0.7;

/** Integer hash to [0, 1). */
function hash(x: number, y: number, z: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647 + seed * 1274126177) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const fade = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);
const wrap = (i: number, n: number): number => ((i % n) + n) % n;
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Three hashes in [0, 1) per cell of a period of \`cells\` cells a side: a gradient (as 2h - 1) or a feature point's jitter. */
function lattice(cells: number, seed: number): Float32Array {
  const out = new Float32Array(cells * cells * cells * 3);
  for (let z = 0; z < cells; z++) for (let y = 0; y < cells; y++) for (let x = 0; x < cells; x++) {
    const o = ((z * cells + y) * cells + x) * 3;
    for (let k = 0; k < 3; k++) out[o + k] = hash(x, y, z, seed + k);
  }
  return out;
}

/** Tileable 3D gradient noise over the gradient lattice \`g\`, at (x, y, z) in cells. */
function gradient(g: Float32Array, cells: number, x: number, y: number, z: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z), fx = x - ix, fy = y - iy, fz = z - iz;
  const corner = (dx: number, dy: number, dz: number): number => {
    const o = ((wrap(iz + dz, cells) * cells + wrap(iy + dy, cells)) * cells + wrap(ix + dx, cells)) * 3;
    return (g[o] * 2 - 1) * (fx - dx) + (g[o + 1] * 2 - 1) * (fy - dy) + (g[o + 2] * 2 - 1) * (fz - dz);
  };
  const u = fade(fx), v = fade(fy), w = fade(fz);
  const x00 = lerp(corner(0, 0, 0), corner(1, 0, 0), u), x10 = lerp(corner(0, 1, 0), corner(1, 1, 0), u);
  const x01 = lerp(corner(0, 0, 1), corner(1, 0, 1), u), x11 = lerp(corner(0, 1, 1), corner(1, 1, 1), u);
  return 1.6 * lerp(lerp(x00, x10, v), lerp(x01, x11, v), w);
}

/** Tileable cellular noise over the jitter lattice \`j\`: the gap between the two nearest feature points, at (x, y, z) in cells. */
function cellGap(j: Float32Array, cells: number, x: number, y: number, z: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  let f1 = Infinity, f2 = Infinity;
  for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const o = ((wrap(iz + dz, cells) * cells + wrap(iy + dy, cells)) * cells + wrap(ix + dx, cells)) * 3;
    const px = ix + dx + 0.15 + 0.7 * j[o] - x, py = iy + dy + 0.15 + 0.7 * j[o + 1] - y, pz = iz + dz + 0.15 + 0.7 * j[o + 2] - z;
    const d = px * px + py * py + pz * pz;
    if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) f2 = d;
  }
  return Math.sqrt(f2) - Math.sqrt(f1);
}

const byte = (v: number): number => Math.round(Math.min(Math.max(v, 0), 1) * 255);

function* noiseSteps(): Steps<Uint8Array> {
  const n = BARK_NOISE_SIZE, c = CELLS, out = new Uint8Array(n * n * n * 4);
  const ga = lattice(c, 11), gb = lattice(c, 23), gc = lattice(c, 37), cj = lattice(c, 53);
  for (let z = 0; z < n; z++) {
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const o = ((z * n + y) * n + x) * 4, u = ((x + 0.5) / n) * c, v = ((y + 0.5) / n) * c, w = ((z + 0.5) / n) * c;
      out[o] = byte(0.5 + 0.4 * gradient(ga, c, u, v, w));
      out[o + 1] = byte(0.5 + 0.4 * gradient(gb, c, u, v, w));
      out[o + 2] = byte(0.5 + 0.4 * gradient(gc, c, u, v, w));
      out[o + 3] = byte(cellGap(cj, c, u, v, w) / CELL_GAP_RANGE);
    }
    yield;
  }
  return out;
}

/** The texture's texels, rgba8 in x-fastest order (BARK_NOISE_SIZE^3 x 4 bytes, 8 MiB). */
export function buildBarkNoise(): Uint8Array {
  return runSync(noiseSteps());
}

let built: Promise<Uint8Array> | null = null;
/**
 * The same texels built in slices with an event-loop yield between them (see slices.ts), once: later calls (a vegetation module
 * initialised again, the extreme tier switched on or off, a render-server module swap) get the same array, which the caller only uploads.
 */
export function buildBarkNoiseSliced(budgetMs = 8): Promise<Uint8Array> {
  built ??= runSliced(noiseSteps(), budgetMs);
  built.catch(() => { built = null; });
  return built;
}
`,bx=`import type { RenderQuality } from '../../contracts';

/**
 * Photoscanned bark (public/textures/bark/bark.bin, built by tools/bark/build_bark_scans.py from CC0 scans; see LICENSE.md there). Two BC7
 * texture arrays, one layer per scan: \`colour\` holds albedo and ambient occlusion, \`surface\` the normal, height and roughness. The tree
 * shader maps them on the near trunks at the high tier and up; the low and medium tiers, and any device without BC compression, keep the
 * procedural bark.
 */
export const BARK_SCANS_URL = \`\${import.meta.env.BASE_URL}textures/bark/bark.bin\`;

/** Layer order in the arrays; tree_bark.wgsl's SCAN_* constants match. */
export const SCAN_LAYERS = ['pine-plates', 'pine-flakes', 'oak', 'spruce', 'beech', 'birch-paper'] as const;

/** \`metres\` of bark one tile covers round the limb and \`along\` up it (a tall scan is stored squeezed into its square tile, whole). */
export interface BarkScanLayer { name: string; metres: number; along: number; source: string; licence: string }

export interface BarkScans {
  size: number;
  mips: number;
  layers: BarkScanLayer[];
  /** Per texture ('colour', 'surface'), per mip, the BC7 blocks of every layer one after the other. */
  blocks: { colour: Uint8Array[]; surface: Uint8Array[] };
}

/** Tiers that use the scans, and how many of the top mips they skip (the high tier loads them at half resolution). */
export function scanMipSkip(tier: RenderQuality): number | null {
  if (tier === 'low' || tier === 'medium') return null;
  return tier === 'high' ? 1 : 0;
}

/** Parses bark.bin; throws on anything malformed. */
export function parseBarkScans(buf: ArrayBuffer): BarkScans {
  const view = new DataView(buf);
  if (buf.byteLength < 8 || new TextDecoder().decode(new Uint8Array(buf, 0, 4)) !== 'BRK1') throw new Error('bark.bin: bad magic');
  const jsonLength = view.getUint32(4, true);
  const head = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, jsonLength))) as { size: number; mips: number; layers: BarkScanLayer[] };
  if (head.layers.length !== SCAN_LAYERS.length || head.layers.some((l, i) => l.name !== SCAN_LAYERS[i])) throw new Error('bark.bin: unexpected layers');
  let at = 8 + jsonLength;
  const blocks = { colour: [] as Uint8Array[], surface: [] as Uint8Array[] };
  for (const tex of ['colour', 'surface'] as const) {
    for (let m = 0; m < head.mips; m++) {
      const side = Math.max(head.size >> m, 4), bytes = (side / 4) * (side / 4) * 16 * head.layers.length;
      if (at + bytes > buf.byteLength) throw new Error('bark.bin: truncated');
      blocks[tex].push(new Uint8Array(buf, at, bytes));
      at += bytes;
    }
  }
  return { size: head.size, mips: head.mips, layers: head.layers, blocks };
}

/** Loads the scans, or null when they are missing or unreadable (the procedural bark stands in). */
export async function loadBarkScans(url = BARK_SCANS_URL): Promise<BarkScans | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return parseBarkScans(await res.arrayBuffer());
  } catch {
    return null;
  }
}

/** The two texture arrays on the GPU, skipping the top \`skip\` mips. */
export function uploadBarkScans(dev: GPUDevice, scans: BarkScans, skip: number): { colour: GPUTexture; surface: GPUTexture } {
  const layers = scans.layers.length, size = scans.size >> skip, mips = scans.mips - skip;
  const make = (tex: 'colour' | 'surface', format: GPUTextureFormat): GPUTexture => {
    const t = dev.createTexture({ label: \`bark-scans-\${tex}\`, size: [size, size, layers], mipLevelCount: mips, format, dimension: '2d', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    for (let m = 0; m < mips; m++) {
      const side = Math.max(size >> m, 4), blocksPerRow = side / 4;
      dev.queue.writeTexture({ texture: t, mipLevel: m }, scans.blocks[tex][m + skip], { bytesPerRow: blocksPerRow * 16, rowsPerImage: blocksPerRow }, [side, side, layers]);
    }
    return t;
  };
  return { colour: make('colour', 'bc7-rgba-unorm-srgb'), surface: make('surface', 'bc7-rgba-unorm') };
}
`,xx=`import type { ObstacleCollider, Vec3 } from '../../contracts';
import type { RTMaterial, RTPrimitive } from '../contracts';
import { MAX_PRIMS } from '../rt/bvh';
import type { InstanceSet, VegPlacement } from './placement';
import { RT_FOLIAGE, plantCanopyShadows, plantWoodShadows } from './plantShadows';
import { rockAssets } from './rockGen';
import { BREAST_HEIGHT, type Limb, type TreePlan } from './treePlan';
import { VARIANT_DEFS, layoutCrown, variantPlan } from './variants';

/** The brief keeps the collider count below 2500; the nearest ones win when a track is very wooded. */
export const MAX_COLLIDERS = 2400;
/** Trees closer than this to the racing line get a trunk box. */
export const TREE_COLLIDER_RANGE = 60;
export const ROCK_COLLIDER_RANGE = 40;
/** Rocks smaller than this radius are not worth a collider. */
export const MIN_BOULDER_RADIUS = 0.6;
/**
 * Trunk box half-width limits (m): thin stems still get a box a drone can hit, and the cap is above the girth of the oldest oaks, so a box
 * always covers its drawn trunk.
 */
export const TRUNK_HALF_MIN = 0.15;
export const TRUNK_HALF_MAX = 1.2;
/** Trunk boxes stop a little below the tip, where the stem is too thin to matter. */
const TRUNK_HEIGHT_FRACTION = 0.9;
/** A boulder's box covers this fraction of its radius on each side of the centre. */
const BOULDER_HALF = 0.7;

/** Most ray-tracing primitives the natural forest gets: trees, bushes and rocks nearest the focus, whole plants only. */
export const RT_PRIM_CAP = 1500;
/**
 * The extreme tier's forest proxies: every plant within about 100 m of a race line (13-14k primitives on the 1024-cell worlds), ranked by
 * distance to the line. A tree without proxies is open sky to the GI rays from its own leaves, so its crown is lit as brightly inside as out.
 */
export const RT_PRIM_CAP_EXTREME = 16000;
/**
 * Of the extreme tier's forest budget, the share kept for the plants nearest the camera that the race-line set leaves out (lone trees,
 * park and free-flight views off the line): about a 50 m round of trees, in the dynamic tree so moving it never rebuilds the static one.
 */
export const RT_CAMERA_PRIMS = 3000;
/** The camera's set is re-ranked once the camera has moved this far (m) from where it was last ranked. */
export const RT_CAMERA_RERANK = 50;
/** Plants farther than this (m) from the camera are not ranked for its set (a re-rank sorts only the near ones). */
export const RT_CAMERA_WITHIN = 150;

/** How an extreme-tier forest budget splits between the race line and the camera's round. */
export const cameraShare = (cap: number): number => Math.min(RT_CAMERA_PRIMS, Math.floor(cap / 4));

/** Primitives left free under the BVH's MAX_PRIMS when the forest takes what the other groups (park, track) leave. */
export const RT_PRIM_MARGIN = 1024;

/** The forest's primitive budget for the tier, given how many the other static groups already use, so the whole scene stays under MAX_PRIMS. */
export function forestRtCap(extreme: boolean, usedByOthers: number): number {
  return Math.max(0, Math.min(extreme ? RT_PRIM_CAP_EXTREME : RT_PRIM_CAP, MAX_PRIMS - RT_PRIM_MARGIN - usedByOthers));
}
export { RT_FOLIAGE };
const RT_ROCK: RTMaterial = { albedo: [0.27, 0.26, 0.24], roughness: 0.95, metalness: 0 };

interface Candidate {
  dist: number;
  key: number;
  box: ObstacleCollider;
}

/**
 * One trunk box in a tree's own frame at scale 1: centre x and z, the heights it spans, the stem radius it wraps and how far the stem's
 * centreline strays sideways inside it.
 */
export interface StemBox { x: number; z: number; y0: number; y1: number; radius: number; spread: number }

/** Most boxes a tree's trunk is cut into where it leans or bends, shared between the stems of a clump. */
export const MAX_TRUNK_BOXES = 6;
const MAX_STEM_BOXES = 4;
/** A stem's box is cut in two while its centreline strays more than this share of the stem radius (or STRAY_MIN metres) inside one box. */
const SPREAD_OF_RADIUS = 0.6;
const STRAY_MIN = 0.25;

const stemCache = new Map<number, StemBox[]>();

/** Centreline point and radius of a stem at height y (its points rise monotonically). */
function stemSample(stem: Limb, y: number): [number, number, number] {
  const p = stem.pts;
  let i = 0;
  while (i < p.length - 2 && p[i + 1][1] < y) i++;
  const t = Math.min(Math.max((y - p[i][1]) / Math.max(p[i + 1][1] - p[i][1], 1e-6), 0), 1);
  return [p[i][0] + (p[i + 1][0] - p[i][0]) * t, p[i][2] + (p[i + 1][2] - p[i][2]) * t, stem.radii[i] + (stem.radii[i + 1] - stem.radii[i]) * t];
}

/**
 * The trunk boxes of a tree variant at scale 1: every stem (a birch clump has several) from the ground up to the crown's top, never into the
 * whisker-thin tip, cut into up to MAX_STEM_BOXES stacked boxes (MAX_TRUNK_BOXES for all the stems of a clump) so a leaning or crooked stem stays inside them. The radius of the lowest box
 * is the breast-height radius (the root flare below it is left out), higher boxes take the stem's radius at their middle.
 */
export function stemBoxes(variant: number): StemBox[] {
  let fit = stemCache.get(variant);
  if (fit) return fit;
  const plan = variantPlan(variant) as TreePlan, out: StemBox[] = [];
  const crownTop = Math.min(plan.height * TRUNK_HEIGHT_FRACTION, layoutCrown(variant)?.crownTop ?? plan.crownC[1] + plan.crownR[1]);
  const stems = plan.limbs.filter((l) => l.order === 0), most = Math.min(MAX_STEM_BOXES, Math.max(1, Math.floor(MAX_TRUNK_BOXES / stems.length)));
  for (const stem of stems) {
    // Above a broadleaf's fork the column carries on straight up from the top of the bole, through the solid core of the crown.
    const top = crownTop;
    const piece = (y0: number, y1: number, first: boolean): StemBox => {
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (let k = 0; k <= 16; k++) {
        const [x, z] = stemSample(stem, y0 + ((y1 - y0) * k) / 16);
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z);
      }
      const radius = first ? stemSample(stem, Math.min(BREAST_HEIGHT, top))[2] : stemSample(stem, (y0 + y1) / 2)[2];
      return { x: (x0 + x1) / 2, z: (z0 + z1) / 2, y0, y1, radius, spread: Math.max(x1 - x0, z1 - z0) / 2 };
    };
    let boxes: StemBox[] = [];
    for (let n = 1; n <= most; n++) {
      boxes = Array.from({ length: n }, (_, k) => piece((top * k) / n, (top * (k + 1)) / n, k === 0));
      if (boxes.every((b) => b.spread <= Math.max(SPREAD_OF_RADIUS * b.radius, STRAY_MIN))) break;
    }
    out.push(...boxes);
  }
  stemCache.set(variant, out);
  return out;
}

/** Boxes around the solid part of a placed tree: one per stem box, each as wide as its stem (within the trunk limits) plus the stem's stray. */
function trunkBoxes(place: InstanceSet, i: number): ObstacleCollider[] {
  const s = place.scale[i], yaw = place.yaw[i], c = Math.cos(yaw), sn = Math.sin(yaw);
  return stemBoxes(place.variant[i]).map((b): ObstacleCollider => {
    const half = Math.min(Math.max(b.radius * s, TRUNK_HALF_MIN), TRUNK_HALF_MAX) + b.spread * s;
    const x = b.x * s, z = b.z * s, h = 0.5 * (b.y1 - b.y0) * s;
    return { kind: 'box', center: [place.pos[i * 3] + c * x + sn * z, place.pos[i * 3 + 1] + b.y0 * s + h, place.pos[i * 3 + 2] - sn * x + c * z], half: [half, h, half], yaw };
  });
}

function boulderBox(place: InstanceSet, i: number): ObstacleCollider {
  const s = place.scale[i], rock = rockAssets()[VARIANT_DEFS[place.variant[i]].rock];
  const h = 0.5 * rock.height * s;
  return { kind: 'box', center: [place.pos[i * 3], place.pos[i * 3 + 1] + h, place.pos[i * 3 + 2]], half: [BOULDER_HALF * s, h, BOULDER_HALF * s], yaw: place.yaw[i] };
}

/**
 * Trunk boxes (one or more per tree, see stemBoxes) for the trees along the racing line and boxes for the boulders next to it, nearest first, at most MAX_COLLIDERS.
 * The order is a pure function of the placement, so equal seeds give identical lists.
 */
export function buildColliders(place: VegPlacement): ObstacleCollider[] {
  const out: Candidate[] = [];
  const { plants, rocks } = place;
  for (let i = 0; i < plants.count; i++) {
    if (VARIANT_DEFS[plants.variant[i]].group !== 'tree' || !(plants.pathDist[i] <= TREE_COLLIDER_RANGE)) continue;
    for (const box of trunkBoxes(plants, i)) out.push({ dist: plants.pathDist[i], key: i, box });
  }
  for (let i = 0; i < rocks.count; i++) {
    if (rocks.scale[i] < MIN_BOULDER_RADIUS || !(rocks.pathDist[i] <= ROCK_COLLIDER_RANGE)) continue;
    out.push({ dist: rocks.pathDist[i], key: plants.count + i, box: boulderBox(rocks, i) });
  }
  out.sort((a, b) => a.dist - b.dist || a.key - b.key);
  if (out.length > MAX_COLLIDERS) out.length = MAX_COLLIDERS;
  return out.map((c) => c.box);
}

/** Rocks smaller than this radius (metres) cast no ray-traced shadow. */
export const MIN_SHADOW_ROCK_RADIUS = 0.3;

const rockFits: { center: Vec3; half: Vec3 }[] = [];

/** The ellipsoid that spans a rock's drawn mesh at scale 1 (the box round the finest level of detail, rounded to an ellipsoid). */
function rockEllipsoid(shape: number): { center: Vec3; half: Vec3 } {
  if (!rockFits[shape]) {
    const mesh = rockAssets()[shape].lods[0], lo: Vec3 = [Infinity, Infinity, Infinity], hi: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (let v = 0; v < mesh.vertexCount; v++) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], mesh.pos[v * 3 + k]); hi[k] = Math.max(hi[k], mesh.pos[v * 3 + k]); }
    rockFits[shape] = { center: [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2], half: [(hi[0] - lo[0]) / 2, (hi[1] - lo[1]) / 2, (hi[2] - lo[2]) / 2] };
  }
  return rockFits[shape];
}

/** Rank offset of a plant with no line distance when ranking along the line: past any distance a line can have. */
const OFF_LINE = 1e6;

/** A plant's or a rock's key in RtProxyOptions' skip and taken sets. */
export const proxyKey = (i: number, rock: boolean): number => (rock ? -1 - i : i);

export interface RtProxyOptions {
  /** Rank by distance to the racing line, where the camera flies (falling back to \`focus\` with no line), instead of to \`focus\`. */
  alongLine?: boolean;
  /** Only what stands within this distance (m) of \`focus\` (or of the line). */
  within?: number;
  /** Plants and rocks (proxyKey) to leave out: another set has them already. */
  skip?: ReadonlySet<number>;
  /** Filled with the proxyKey of every plant and rock that got proxies. */
  taken?: Set<number>;
}

/**
 * Ray-tracing proxies for what stands nearest \`focus\` (see RtProxyOptions), \`cap\` primitives at most. A tree gets a capsule along its leaning trunk and the canopy spheres fitted to its
 * leaves; a bush gets its canopy spheres; a rock gets an ellipsoid over its mesh. Each is laid out with the instance's own yaw and scale.
 */
export function buildRtProxies(place: VegPlacement, focus: Vec3, cap = RT_PRIM_CAP, o: RtProxyOptions = {}): RTPrimitive[] {
  const { plants, rocks } = place;
  const near: { d: number; i: number; rock: boolean }[] = [];
  // Along the line, plants with no line distance (placement measures it only near the line) come after every plant that has one, nearest
  // \`focus\` first.
  const toFocus = (set: InstanceSet, i: number): number => Math.hypot(set.pos[i * 3] - focus[0], set.pos[i * 3 + 2] - focus[2]);
  const dist = (set: InstanceSet, i: number): number =>
    !o.alongLine ? toFocus(set, i) : Number.isFinite(set.pathDist[i]) ? set.pathDist[i] : OFF_LINE + toFocus(set, i);
  const within = o.within ?? Infinity;
  const consider = (i: number, rock: boolean, d: number): void => { if (d <= within && !o.skip?.has(proxyKey(i, rock))) near.push({ d, i, rock }); };
  for (let i = 0; i < plants.count; i++) consider(i, false, dist(plants, i));
  for (let i = 0; i < rocks.count; i++) if (rocks.scale[i] >= MIN_SHADOW_ROCK_RADIUS) consider(i, true, dist(rocks, i));
  near.sort((a, b) => a.d - b.d || +a.rock - +b.rock || a.i - b.i);
  const prims: RTPrimitive[] = [];
  for (const { i, rock } of near) {
    if (prims.length >= cap) break;
    const set = rock ? rocks : plants, variant = set.variant[i], pos: Vec3 = [set.pos[i * 3], set.pos[i * 3 + 1], set.pos[i * 3 + 2]];
    const at = { pos, yaw: set.yaw[i], scale: set.scale[i] };
    let made: RTPrimitive[];
    if (rock) {
      const fit = rockEllipsoid(VARIANT_DEFS[variant].rock), c = Math.cos(at.yaw), s = Math.sin(at.yaw);
      const x = fit.center[0] * at.scale, z = fit.center[2] * at.scale;
      made = [{ type: 'ellipsoid', center: [pos[0] + c * x + s * z, pos[1] + fit.center[1] * at.scale, pos[2] - s * x + c * z], half: fit.half.map(h => h * at.scale) as Vec3,
        rot: [0, Math.sin(at.yaw / 2), 0, Math.cos(at.yaw / 2)], material: RT_ROCK }];
    } else if (!variantPlan(variant)) continue;
    else made = [...plantWoodShadows(variant, at, false), ...plantCanopyShadows(variant, at)];
    // A plant is all or nothing: half a tree would be a trunk with no crown.
    if (prims.length + made.length > cap) break;
    prims.push(...made);
    o.taken?.add(proxyKey(i, rock));
  }
  return prims;
}
`,Sx=`import type { RenderContext } from '../contracts';
import { DEPTH_STATE, GBUFFER_TARGETS } from '../contracts';
import { FAR_CARD_BYTES, farToneDefines, type FarForest } from './treePlanFar';

/** The shader module, bind-group layout and pipeline of the far canopy: scene independent, so built once and shared by every FarCanopy. */
export class FarCanopyPipeline {
  readonly layout: GPUBindGroupLayout;
  pipeline!: GPURenderPipeline;
  /** Resolves once the pipeline has compiled (in the background, so the compile overlaps the later modules' start-up). */
  readonly ready: Promise<void>;

  constructor(rc: RenderContext) {
    const dev = rc.device;
    this.layout = dev.createBindGroupLayout({
      label: 'far-canopy',
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
      ],
    });
    const module = rc.module('vegetation/veg_far.wgsl', farToneDefines());
    this.ready = dev.createRenderPipelineAsync({
      label: 'far-canopy',
      layout: dev.createPipelineLayout({ bindGroupLayouts: [rc.frame.layout, rc.world.layout, this.layout] }),
      vertex: { module, entryPoint: 'vs' },
      fragment: { module, entryPoint: 'fs', targets: GBUFFER_TARGETS },
      primitive: { topology: 'triangle-strip', cullMode: 'none' },
      depthStencil: DEPTH_STATE,
    }).then((p) => { this.pipeline = p; });
  }
}

/**
 * The far-field canopy cards (treePlanFar.ts) as one instanced draw into the G-buffer: 4 vertices per card (2 triangles), static
 * instance buffer, culling and distance fades in the vertex and fragment shaders (veg_far.wgsl), so there is no compute pass.
 * Per scene it owns only the card buffer and its bind group.
 */
export class FarCanopy {
  readonly cards: number;
  readonly bytes: number;
  private readonly buffer: GPUBuffer | null;
  private readonly group: GPUBindGroup | null;
  private readonly pipeline: GPURenderPipeline | null;

  constructor(rc: RenderContext, shared: FarCanopyPipeline, params: GPUBuffer, forest: FarForest) {
    this.cards = forest.count;
    this.bytes = forest.count * FAR_CARD_BYTES;
    if (forest.count === 0) {
      this.buffer = null; this.group = null; this.pipeline = null;
      return;
    }
    const dev = rc.device;
    this.buffer = dev.createBuffer({ label: 'far-canopy-cards', size: this.bytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    dev.queue.writeBuffer(this.buffer, 0, forest.words.buffer, forest.words.byteOffset, this.bytes);
    this.group = dev.createBindGroup({ label: 'far-canopy', layout: shared.layout, entries: [{ binding: 0, resource: { buffer: params } }, { binding: 1, resource: { buffer: this.buffer } }] });
    this.pipeline = shared.pipeline;
  }

  encodeGBuffer(pass: GPURenderPassEncoder | GPURenderBundleEncoder): void {
    if (!this.pipeline || !this.group) return;
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(2, this.group);
    pass.draw(4, this.cards);
  }

  destroy(): void {
    this.buffer?.destroy();
  }
}
`,Cx=`import type { Vec3 } from '../../contracts';

/**
 * Keeps foliage from passing through itself. Every leaf mesh, shoot card or needle ribbon of a tree's near LOD is a Piece; before a piece is
 * emitted it is checked against the pieces already placed near it, and two pieces clash only where their triangles cross AND both are
 * painted (opaque) at the crossing, so transparent card corners crossing each other do not count. A clashing piece is tried again in other
 * poses (the caller's candidates) until it fits, and left out if none does. In the wind the whole tree moves as one smooth field whose slope
 * stays well under one (tree.wgsl treeSway), so pieces apart at rest stay apart; countCrossings can check that for any displacement.
 */

export interface Piece {
  pos: Vec3[];
  uv: [number, number][];
  tris: [number, number, number][];
  /** Opacity of the piece's texture at an atlas uv. */
  opaque: (u: number, v: number) => boolean;
  /** Whether the texture paints anything within a few centimetres of an atlas uv (for the clearance check, which probes a sparse grid). */
  near: (u: number, v: number) => boolean;
  /** Room (m) its paint keeps from its neighbours' (the larger of the two counts): the wind moves each triangle's corners and keeps it flat, which
   * bends a crown a little differently from the smooth field it follows, so pieces closer than that could touch. */
  room: number;
  /** How far (m) the foliage a piece stands for reaches off its surface either way (a whole shoot placed as its card), 0 for a plain piece. */
  spread?: number;
  /** Pieces of one group (a crossed pair of cards or ribbons meeting along a shared stem) may cross each other. */
  group: number;
}

const CELL = 0.4;
/** Points tested along the line where two triangles cross, for paint on both. */
const SAMPLES = 7;
/** Shortest crossing that counts (m). */
const MIN_CROSSING = 0.001;

/** A placed piece, its bounds, its order of placing, and the last neighbour query that found it. */
interface Placed { piece: Piece; lo: Vec3; hi: Vec3; id: number; seen: number }

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

function bounds(pos: readonly Vec3[]): [Vec3, Vec3] {
  const lo: Vec3 = [Infinity, Infinity, Infinity], hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const p of pos) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[k]); hi[k] = Math.max(hi[k], p[k]); }
  return [lo, hi];
}

/** Segment where triangle a crosses the plane of triangle b, as two points, or null. */
function planeCut(a: readonly Vec3[], n: Vec3, d: number): [Vec3, Vec3] | null {
  const s = a.map((p) => dot(n, p) - d);
  const out: Vec3[] = [];
  for (let i = 0; i < 3; i++) {
    const j = (i + 1) % 3;
    if ((s[i] > 0) !== (s[j] > 0)) {
      const t = s[i] / (s[i] - s[j]);
      out.push([a[i][0] + (a[j][0] - a[i][0]) * t, a[i][1] + (a[j][1] - a[i][1]) * t, a[i][2] + (a[j][2] - a[i][2]) * t]);
    }
  }
  return out.length === 2 ? [out[0], out[1]] : null;
}

/** Barycentric weights of point p in triangle t (p on its plane). */
function bary(t: readonly Vec3[], p: Vec3): [number, number, number] {
  const v0 = sub(t[1], t[0]), v1 = sub(t[2], t[0]), v2 = sub(p, t[0]);
  const d00 = dot(v0, v0), d01 = dot(v0, v1), d11 = dot(v1, v1), d20 = dot(v2, v0), d21 = dot(v2, v1);
  const den = d00 * d11 - d01 * d01 || 1e-12;
  const v = (d11 * d20 - d01 * d21) / den, w = (d00 * d21 - d01 * d20) / den;
  return [1 - v - w, v, w];
}

function opaqueAt(piece: Piece, tri: readonly number[], w: readonly number[], near = false): boolean {
  const [a, b, c] = tri;
  const u = piece.uv[a][0] * w[0] + piece.uv[b][0] * w[1] + piece.uv[c][0] * w[2];
  const v = piece.uv[a][1] * w[0] + piece.uv[b][1] * w[1] + piece.uv[c][1] * w[2];
  return near ? piece.near(u, v) : piece.opaque(u, v);
}

/** Bounds of each triangle of a piece at the given positions, as [lo, hi] pairs; cached for a piece's rest positions. */
const restBoxes = new WeakMap<readonly Vec3[], [Vec3, Vec3][]>();
function triBoxes(piece: Piece, pos: readonly Vec3[]): [Vec3, Vec3][] {
  let boxes = pos === piece.pos ? restBoxes.get(pos) : undefined;
  if (!boxes) {
    boxes = piece.tris.map((t) => bounds(t.map((i) => pos[i])));
    if (pos === piece.pos) restBoxes.set(pos, boxes);
  }
  return boxes;
}

/**
 * Points of a triangle (barycentric weights on a grid) probed for how close they come to another piece: in twelfths (a few centimetres apart
 * on a shoot card), or in quarters where the room to keep is wide (a whole shoot placed as its card), which needs no finer look.
 */
const probeGrid = (steps: number): [number, number, number][] => {
  const out: [number, number, number][] = [];
  for (let i = 0; i <= steps; i++) for (let j = 0; j <= steps - i; j++) out.push([i / steps, j / steps, (steps - i - j) / steps]);
  return out;
};
const PROBES = probeGrid(12), COARSE_PROBES = probeGrid(4);
/** Spacing (m) the fine probes aim for. */
const PROBE_SPACING = 0.04;
/** Room (m) from which the coarse probes are used. */
const COARSE_ROOM = 0.03;

/** The probes of a triangle (by index) of a piece that land on or near paint; the same for every pose of a piece (they share its uv). */
const painted = new WeakMap<object, [number, number, number][][]>(), paintedCoarse = new WeakMap<object, [number, number, number][][]>();
function paintedProbes(p: Piece, tri: number, coarse: boolean): [number, number, number][] {
  const cache = coarse ? paintedCoarse : painted;
  let all = cache.get(p.uv);
  if (!all) {
    all = p.tris.map((t) => {
      // About PROBE_SPACING apart along the triangle's longest edge (a small leaf needs far fewer probes than a shoot card), at most the full grid.
      const e = Math.max(...[[0, 1], [1, 2], [2, 0]].map(([i, j]) => Math.hypot(...sub(p.pos[t[i]], p.pos[t[j]]))));
      const steps = coarse ? 4 : Math.min(12, Math.max(2, Math.ceil(e / PROBE_SPACING)));
      return (steps === 12 ? PROBES : steps === 4 && coarse ? COARSE_PROBES : probeGrid(steps)).filter((w) => opaqueAt(p, t, w, true));
    });
    cache.set(p.uv, all);
  }
  return all[tri];
}

/** Unit normal and offset of each triangle of a piece at rest (null for a degenerate one); cached, as a piece is compared many times. */
const restPlanes = new WeakMap<readonly Vec3[], ({ n: Vec3; d: number } | null)[]>();
function triPlanes(p: Piece): ({ n: Vec3; d: number } | null)[] {
  let planes = restPlanes.get(p.pos);
  if (!planes) {
    planes = p.tris.map((t) => {
      const n = cross(sub(p.pos[t[1]], p.pos[t[0]]), sub(p.pos[t[2]], p.pos[t[0]])), l = Math.hypot(n[0], n[1], n[2]);
      if (l < 1e-9) return null;
      const u: Vec3 = [n[0] / l, n[1] / l, n[2] / l];
      return { n: u, d: dot(u, p.pos[t[0]]) };
    });
    restPlanes.set(p.pos, planes);
  }
  return planes;
}

/** True if a painted point of b (probed on a grid over each triangle; near paint counts) lies within \`gap\` of paint on a, along a's normal. */
function within(a: Piece, b: Piece, gap: number): boolean {
  const boxesA = triBoxes(a, a.pos), boxesB = triBoxes(b, b.pos);
  const planesA = triPlanes(a);
  for (let i = 0; i < a.tris.length; i++) {
    const plane = planesA[i];
    if (!plane) continue;
    const [alo, ahi] = boxesA[i], ta = a.tris[i], A = ta.map((k) => a.pos[k]), { n, d } = plane;
    for (let j = 0; j < b.tris.length; j++) {
      const [blo, bhi] = boxesB[j];
      if (ahi[0] + gap < blo[0] || alo[0] - gap > bhi[0] || ahi[1] + gap < blo[1] || alo[1] - gap > bhi[1] || ahi[2] + gap < blo[2] || alo[2] - gap > bhi[2]) continue;
      const tb = b.tris[j], B = tb.map((k) => b.pos[k]);
      // The distance to a's plane is linear over b's triangle: skip it when all of it is further than the gap on one side.
      const s0 = dot(n, B[0]) - d, s1 = dot(n, B[1]) - d, s2 = dot(n, B[2]) - d;
      if ((s0 >= gap && s1 >= gap && s2 >= gap) || (s0 <= -gap && s1 <= -gap && s2 <= -gap)) continue;
      // Where each probe lands on a's triangle is linear in the probe's weights too: work it out at b's corners and blend.
      const c0 = bary(A, sub(B[0], [n[0] * s0, n[1] * s0, n[2] * s0])), c1 = bary(A, sub(B[1], [n[0] * s1, n[1] * s1, n[2] * s1]));
      const c2 = bary(A, sub(B[2], [n[0] * s2, n[1] * s2, n[2] * s2]));
      // b's triangle lands wholly outside a's (beyond one of its edges): nothing to probe.
      if ((c0[0] < 0 && c1[0] < 0 && c2[0] < 0) || (c0[1] < 0 && c1[1] < 0 && c2[1] < 0) || (c0[2] < 0 && c1[2] < 0 && c2[2] < 0)) continue;
      for (const w of paintedProbes(b, j, gap >= COARSE_ROOM)) {
        const s = s0 * w[0] + s1 * w[1] + s2 * w[2];
        if (s >= gap || s <= -gap) continue;
        const wa: Vec3 = [c0[0] * w[0] + c1[0] * w[1] + c2[0] * w[2], c0[1] * w[0] + c1[1] * w[1] + c2[1] * w[2], c0[2] * w[0] + c1[2] * w[1] + c2[2] * w[2]];
        if (wa[0] < 0 || wa[1] < 0 || wa[2] < 0) continue;
        if (opaqueAt(a, ta, wa, true)) return true;
      }
    }
  }
  return false;
}

/** True where some triangle of a crosses some triangle of b, at positions pa and pb, at a point both paint opaque. */
export function visiblyCross(a: Piece, pa: readonly Vec3[], b: Piece, pb: readonly Vec3[]): boolean {
  // Always tested the same way round (by first vertex), so a pair gives the same answer whichever of the two is placed first.
  if (pa[0][0] > pb[0][0] || (pa[0][0] === pb[0][0] && pa[0][2] > pb[0][2])) [a, pa, b, pb] = [b, pb, a, pa];
  const boxesA = triBoxes(a, pa), boxesB = triBoxes(b, pb);
  for (let i = 0; i < a.tris.length; i++) {
    const [alo, ahi] = boxesA[i];
    for (let j = 0; j < b.tris.length; j++) {
      const [blo, bhi] = boxesB[j];
      if (ahi[0] < blo[0] || alo[0] > bhi[0] || ahi[1] < blo[1] || alo[1] > bhi[1] || ahi[2] < blo[2] || alo[2] > bhi[2]) continue;
      const ta = a.tris[i], tb = b.tris[j];
      const a0 = pa[ta[0]], a1 = pa[ta[1]], a2 = pa[ta[2]], b0 = pb[tb[0]], b1 = pb[tb[1]], b2 = pb[tb[2]];
      // Each triangle must straddle the other's plane (the cheap test that rejects nearly every pair) before the crossing is worked out.
      const na = cross(sub(a1, a0), sub(a2, a0)), da = dot(na, a0);
      const s0 = dot(na, b0) - da, s1 = dot(na, b1) - da, s2 = dot(na, b2) - da;
      if ((s0 > 0 && s1 > 0 && s2 > 0) || (s0 <= 0 && s1 <= 0 && s2 <= 0)) continue;
      const nb = cross(sub(b1, b0), sub(b2, b0)), db = dot(nb, b0);
      const r0 = dot(nb, a0) - db, r1 = dot(nb, a1) - db, r2 = dot(nb, a2) - db;
      if ((r0 > 0 && r1 > 0 && r2 > 0) || (r0 <= 0 && r1 <= 0 && r2 <= 0)) continue;
      if (dot(na, na) < 1e-14 || dot(nb, nb) < 1e-14) continue;
      const A = [a0, a1, a2], B = [b0, b1, b2];
      const sa = planeCut(A, nb, db), sb = planeCut(B, na, da);
      if (!sa || !sb) continue;
      // Both segments lie on the line where the planes meet; the triangles cross on the overlap of the two.
      const dir = cross(na, nb);
      const ta0 = dot(dir, sa[0]), ta1 = dot(dir, sa[1]), tb0 = dot(dir, sb[0]), tb1 = dot(dir, sb[1]);
      const lo = Math.max(Math.min(ta0, ta1), Math.min(tb0, tb1)), hi = Math.min(Math.max(ta0, ta1), Math.max(tb0, tb1));
      // Pieces that only touch (two stalks meeting at one point on a twig) do not count: the crossing must be at least a millimetre long.
      if (hi - lo <= MIN_CROSSING * Math.hypot(dir[0], dir[1], dir[2])) continue;
      const seg = ta1 - ta0 || 1e-12;
      for (let s = 0; s < SAMPLES; s++) {
        const t = lo + (hi - lo) * (s + 0.5) / SAMPLES, f = (t - ta0) / seg;
        const p: Vec3 = [sa[0][0] + (sa[1][0] - sa[0][0]) * f, sa[0][1] + (sa[1][1] - sa[0][1]) * f, sa[0][2] + (sa[1][2] - sa[0][2]) * f];
        if (opaqueAt(a, ta, bary(A, p)) && opaqueAt(b, tb, bary(B, p))) return true;
      }
    }
  }
  return false;
}

export class FoliageSpace {
  private readonly cells = new Map<number, Placed[]>();
  /** Pieces placed, and pieces left out (they crossed something in every pose). */
  placed = 0;
  dropped = 0;
  /** The most room and spread of any placed piece, to know how far to look for neighbours. */
  private room = 0;
  private spread = 0;

  private keys(lo: Vec3, hi: Vec3): number[] {
    const out: number[] = [];
    for (let x = Math.floor(lo[0] / CELL); x <= Math.floor(hi[0] / CELL); x++)
      for (let y = Math.floor(lo[1] / CELL); y <= Math.floor(hi[1] / CELL); y++)
        for (let z = Math.floor(lo[2] / CELL); z <= Math.floor(hi[2] / CELL); z++) out.push(((x + 1024) * 2048 + y + 1024) * 2048 + z + 1024);
    return out;
  }

  private query = 0;
  private neighbours(lo: Vec3, hi: Vec3, pad: number): Placed[] {
    const out: Placed[] = [], stamp = ++this.query;
    const l: Vec3 = [lo[0] - pad, lo[1] - pad, lo[2] - pad], h: Vec3 = [hi[0] + pad, hi[1] + pad, hi[2] + pad];
    for (const k of this.keys(l, h)) for (const q of this.cells.get(k) ?? []) {
      if (q.seen === stamp || q.hi[0] < l[0] || q.lo[0] > h[0] || q.hi[1] < l[1] || q.lo[1] > h[1] || q.hi[2] < l[2] || q.lo[2] > h[2]) continue;
      q.seen = stamp;
      out.push(q);
    }
    return out;
  }

  /**
   * True if p visibly crosses a placed piece of another group, or a painted part of either comes within the room they keep of the other
   * (plus how far each one's foliage spreads off it).
   */
  private clashes(p: Piece, standIn?: Piece): boolean {
    const [lo, hi] = bounds(p.pos);
    return this.neighbours(lo, hi, Math.max(p.room, this.room) + (p.spread ?? 0) + this.spread).some((q) => {
      if (q.piece.group === p.group || q.piece === standIn) return false;
      // The query looked as far as the widest room of any piece; most pairs need far less.
      const room = Math.max(p.room, q.piece.room) + (p.spread ?? 0) + (q.piece.spread ?? 0);
      for (let k = 0; k < 3; k++) if (q.lo[k] > hi[k] + room || q.hi[k] < lo[k] - room) return false;
      return visiblyCross(p, p.pos, q.piece, q.piece.pos) || within(p, q.piece, room) || within(q.piece, p, room);
    });
  }

  /**
   * Places the first of the candidate poses (\`make(k)\`, k = 0, 1, ...; null when out of candidates) that crosses nothing, and returns it to
   * emit; a piece that crosses something in every pose is left out (null). With \`also\`, the pose must fit there too (ignoring \`standIn\`, the card that holds the place of the shoot the piece belongs to), and goes into both.
   */
  place(make: (k: number) => Piece | null, also?: FoliageSpace, standIn?: Piece): Piece | null {
    for (let k = 0; ; k++) {
      const p = make(k);
      if (!p) break;
      if (!this.clashes(p) && !also?.clashes(p, standIn)) { this.add(p); also?.add(p); return p; }
    }
    this.dropped++;
    return null;
  }

  /** A space holding the given pieces as they are, unchecked (to count what crosses among a finished set). */
  static of(pieces: readonly Piece[]): FoliageSpace {
    const s = new FoliageSpace();
    for (const p of pieces) s.add(p);
    return s;
  }

  private add(p: Piece): void {
    const [lo, hi] = bounds(p.pos);
    const entry: Placed = { piece: p, lo, hi, id: this.placed, seen: 0 };
    for (const k of this.keys(lo, hi)) {
      let list = this.cells.get(k);
      if (!list) this.cells.set(k, (list = []));
      list.push(entry);
    }
    this.placed++;
    this.room = Math.max(this.room, p.room);
    this.spread = Math.max(this.spread, p.spread ?? 0);
  }

  /** Pairs of placed pieces (of different groups) that visibly cross, at rest or with every vertex moved by . */
  countCrossings(move?: (p: Vec3) => Vec3): number {
    const all = new Set<Placed>();
    for (const list of this.cells.values()) for (const q of list) all.add(q);
    // Moved pieces are counted in a space of their own, so the neighbour search sees them where they moved to.
    if (move) return FoliageSpace.of([...all].map((q) => ({ ...q.piece, pos: q.piece.pos.map(move) }))).countCrossings();
    let n = 0;
    for (const a of all) {
      for (const b of this.neighbours(a.lo, a.hi, 0)) {
        if (b.id <= a.id || b.piece.group === a.piece.group) continue;
        if (visiblyCross(a.piece, a.piece.pos, b.piece, b.piece.pos)) n++;
      }
    }
    return n;
  }
}
`,wx=`import type { TerrainData, TrackData } from '../../contracts';
import { bakeTrackDistance, publishGroundCover, rasterGroundCover, type CoverCrown } from '../terrain/groundCover';
import { publishCanopyShadow, rasterCanopyShadow, type ShadowCrown } from '../terrain/canopyShadow';
import { publishTrunkGrid, rasterTrunkGrid, type Trunk } from '../terrain/trunkGrid';
import type { VegPlacement } from './placement';
import { VARIANT_DEFS, variantPlan } from './variants';

/** Trees drop a full litter layer under their crowns; bushes a thinner one. Conifers (spruce, pine, juniper) shed needles. */
const TREE_STRENGTH = 1;
const BUSH_STRENGTH = 0.45;
const MIN_RADIUS = 1.2;

function* crowns(place: VegPlacement): Generator<CoverCrown> {
  const p = place.plants;
  const out: CoverCrown = { x: 0, z: 0, radius: 0, strength: 0, conifer: false };
  for (let i = 0; i < p.count; i++) {
    const def = VARIANT_DEFS[p.variant[i]];
    if (def.group === 'rock') continue;
    const plan = variantPlan(p.variant[i]);
    out.x = p.pos[i * 3];
    out.z = p.pos[i * 3 + 2];
    out.radius = Math.max((plan ? Math.max(plan.crownR[0], plan.crownR[2]) : 0.25 * def.height) * p.scale[i], MIN_RADIUS);
    out.strength = def.group === 'tree' ? TREE_STRENGTH : BUSH_STRENGTH;
    out.conifer = /^(spruce|pine|juniper)/.test(def.name);
    yield out;
  }
}

function* trunks(place: VegPlacement): Generator<Trunk> {
  const p = place.plants;
  const out: Trunk = { x: 0, z: 0, radius: 0, conifer: false };
  for (let i = 0; i < p.count; i++) {
    const def = VARIANT_DEFS[p.variant[i]];
    const plan = variantPlan(p.variant[i]);
    if (def.group !== 'tree' || !plan) continue;
    out.x = p.pos[i * 3];
    out.z = p.pos[i * 3 + 2];
    out.radius = plan.trunkRadius * p.scale[i];
    out.conifer = /^(spruce|pine|juniper)/.test(def.name);
    yield out;
  }
}

/**
 * Publishes the forest-floor cover of this placement for the terrain shader (see groundCover.ts) and returns it, along with the trunk
 * grid the ground at each tree's foot is drawn from (see trunkGrid.ts). With a track (outside the park, whose lawns are kept) the cover
 * also carries the distance to its racing line, for the worn ground of the course. Reads the placement and the track only.
 */
export function publishForestFloor(terrain: TerrainData, place: VegPlacement, track: TrackData | null = null): Uint8Array {
  const cover = rasterGroundCover(terrain, crowns(place));
  if (track && !track.parkMap && track.path.length > 1) bakeTrackDistance(terrain, track.path, track.closed, cover);
  publishGroundCover(terrain, cover);
  publishTrunkGrid(terrain, rasterTrunkGrid(terrain, trunks(place)));
  return cover;
}

/**
 * Leaf area density (one-sided leaf area per crown volume, times the leaf projection 0.5 and a clumping index, 1/m) by crown type: a broadleaf
 * crown 8 m deep then passes about 3% of the sun through its core and a conifer's denser one less; the shadow kernel cuts the clump gaps that
 * let sunflecks through (rt/shadow.wgsl).
 */
const LEAF_DENSITY_BROADLEAF = 0.45;
const LEAF_DENSITY_CONIFER = 0.6;
const LEAF_DENSITY_BUSH = 0.4;

function* shadowCrowns(place: VegPlacement): Generator<ShadowCrown> {
  const p = place.plants;
  const out: ShadowCrown = { x: 0, y: 0, z: 0, cx: 0, cy: 0, cz: 0, rx: 0, ry: 0, rz: 0, density: 0, cone: false };
  for (let i = 0; i < p.count; i++) {
    const def = VARIANT_DEFS[p.variant[i]];
    const plan = variantPlan(p.variant[i]);
    if (def.group === 'rock' || !plan) continue;
    const s = p.scale[i], c = Math.cos(p.yaw[i]), sn = Math.sin(p.yaw[i]);
    out.x = p.pos[i * 3]; out.y = p.pos[i * 3 + 1]; out.z = p.pos[i * 3 + 2];
    // The crown offset turns with the instance's yaw, as yawRotate does in the vegetation shaders.
    out.cx = (c * plan.crownC[0] + sn * plan.crownC[2]) * s;
    out.cy = plan.crownC[1] * s;
    out.cz = (-sn * plan.crownC[0] + c * plan.crownC[2]) * s;
    out.rx = plan.crownR[0] * s; out.ry = plan.crownR[1] * s; out.rz = plan.crownR[2] * s;
    out.density = def.group === 'bush' ? LEAF_DENSITY_BUSH : /^(spruce|pine|juniper)/.test(def.name) ? LEAF_DENSITY_CONIFER : LEAF_DENSITY_BROADLEAF;
    // A spruce's branches shorten from its lowest whorl to the top (treePlan.ts sprucePlan): its crown is a cone in the plan's box.
    out.cone = plan.species === 'spruce';
    yield out;
  }
}

/** Publishes the crowns of this placement as the sun-shadow canopy map (see canopyShadow.ts). Reads the placement only. */
export function publishCanopyShadowOf(terrain: TerrainData, place: VegPlacement): void {
  publishCanopyShadow(terrain, rasterCanopyShadow(terrain, shadowCrowns(place)));
}
`,Tx=`import type { RenderContext } from '../contracts';
import { DEPTH_STATE, GBUFFER_TARGETS } from '../contracts';
import { BLADE_BYTES, CHUNK_BYTES, grassBudget, type GrassBudget } from './params';
import { GROUND_COVER_SIZE } from '../terrain/groundCover';

const COUNTER_BYTES = 32;
const LODS = [
  { nseg: 7, tip: true },
  { nseg: 3, tip: true },
  { nseg: 1, tip: false },
] as const;

export interface GrassCounters {
  /** Blades appended per LOD in the last sampled frame (before the capacity clamp) and patches that survived culling. */
  lod: [number, number, number];
  patches: number;
  chunks: number;
}

/** Bind-group layouts, shader modules and pipelines of the grass passes: independent of the scene and the quality budget, built once and shared by every GrassSystem. */
export class GrassPipelines {
  readonly genLayout: GPUBindGroupLayout;
  readonly finLayout: GPUBindGroupLayout;
  readonly drawLayout: GPUBindGroupLayout;
  patchesPipe!: GPUComputePipeline;
  bladesPipe!: GPUComputePipeline;
  finDispatchPipe!: GPUComputePipeline;
  finDrawPipe!: GPUComputePipeline;
  drawPipes: GPURenderPipeline[] = [];
  /** Resolves once the pipelines above have compiled (in the background, so the compile overlaps the later modules' start-up). */
  readonly ready: Promise<void>;
  /** Forest-floor cover (see terrain/groundCover.ts): blades under closed crowns are shade grass, not meadow. */
  readonly cover: GPUTexture;
  private readonly device: GPUDevice;

  constructor(rc: RenderContext) {
    const dev = rc.device;
    const C = GPUShaderStage.COMPUTE;
    const storage = (binding: number, type: GPUBufferBindingType = 'storage'): GPUBindGroupLayoutEntry => ({ binding, visibility: C, buffer: { type } });
    const uniform: GPUBindGroupLayoutEntry = { binding: 0, visibility: C, buffer: { type: 'uniform' } };
    this.device = dev;
    this.cover = dev.createTexture({ label: 'grass-ground-cover', size: [GROUND_COVER_SIZE, GROUND_COVER_SIZE], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    this.genLayout = dev.createBindGroupLayout({ label: 'grass-gen', entries: [uniform, storage(1), storage(2), storage(3), { binding: 4, visibility: C, texture: { sampleType: 'float' } }] });
    this.finLayout = dev.createBindGroupLayout({ label: 'grass-fin', entries: [uniform, storage(1), storage(2), storage(3)] });
    const VF = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT;
    this.drawLayout = dev.createBindGroupLayout({
      label: 'grass-draw',
      entries: [{ binding: 0, visibility: VF, buffer: { type: 'uniform' } }, { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } }],
    });
    const layouts = (l: GPUBindGroupLayout): GPUPipelineLayout => dev.createPipelineLayout({ bindGroupLayouts: [rc.frame.layout, rc.world.layout, l] });
    const genPipeLayout = layouts(this.genLayout), finPipeLayout = layouts(this.finLayout), drawPipeLayout = layouts(this.drawLayout);
    const cull = rc.module('vegetation/grass_cull.wgsl');
    const fin = rc.module('vegetation/grass_finalize.wgsl');
    const compute = (label: string, layout: GPUPipelineLayout, module: GPUShaderModule, entryPoint: string): Promise<GPUComputePipeline> =>
      dev.createComputePipelineAsync({ label, layout, compute: { module, entryPoint } });
    const draws = [0, 1, 2].map((i) => {
      const module = rc.module('vegetation/grass.wgsl', { NSEG: LODS[i].nseg, HAS_TIP: LODS[i].tip });
      return dev.createRenderPipelineAsync({
        label: \`grass-lod\${i}\`,
        layout: drawPipeLayout,
        vertex: { module, entryPoint: 'vs' },
        fragment: { module, entryPoint: 'fs', targets: GBUFFER_TARGETS },
        primitive: { topology: 'triangle-strip', cullMode: 'none' },
        depthStencil: DEPTH_STATE,
      });
    });
    this.ready = Promise.all([
      compute('grass-patches', genPipeLayout, cull, 'patches'), compute('grass-blades', genPipeLayout, cull, 'blades_main'),
      compute('grass-fin-dispatch', finPipeLayout, fin, 'fin_dispatch'), compute('grass-fin-draw', finPipeLayout, fin, 'fin_draw'), Promise.all(draws),
    ]).then(([patches, blades, finDispatch, finDraw, drawPipes]) => {
      this.patchesPipe = patches; this.bladesPipe = blades; this.finDispatchPipe = finDispatch; this.finDrawPipe = finDraw; this.drawPipes = drawPipes;
    });
  }

  /** Uploads the scene's forest-floor cover; none (no trees) clears it. */
  setCover(data: Uint8Array | undefined): void {
    const bytes = data ?? new Uint8Array(GROUND_COVER_SIZE * GROUND_COVER_SIZE * 4);
    this.device.queue.writeTexture({ texture: this.cover }, bytes as Uint8Array<ArrayBuffer>, { bytesPerRow: GROUND_COVER_SIZE * 4 }, [GROUND_COVER_SIZE, GROUND_COVER_SIZE]);
  }
}

/**
 * GPU-driven grass: encodePre culls patches, generates and thins blades and writes indirect arguments (compute only, no readback);
 * encodeGBuffer issues three indirect draws, one per blade LOD.
 */
export class GrassSystem {
  readonly budget: GrassBudget;
  private readonly device: GPUDevice;
  private readonly counters: GPUBuffer;
  private readonly chunks: GPUBuffer;
  private readonly blades: GPUBuffer;
  private readonly dispatchArgs: GPUBuffer;
  private readonly drawArgs: GPUBuffer;
  private readonly genGroup: GPUBindGroup;
  private readonly finGroup: GPUBindGroup;
  private readonly drawGroups: GPUBindGroup[] = [];
  private readonly staging: GPUBuffer | null;
  private copyQueued = false;
  private mapping = false;
  private sinceSample = 0;
  readonly counts: GrassCounters = { lod: [0, 0, 0], patches: 0, chunks: 0 };
  /** True once a counter readback has completed. */
  sampled = false;

  constructor(rc: RenderContext, private readonly pipes: GrassPipelines, params: GPUBuffer, readback: boolean) {
    const dev = rc.device;
    this.device = dev;
    const maxBytes = Math.min(dev.limits.maxStorageBufferBindingSize, dev.limits.maxBufferSize);
    this.budget = grassBudget(rc.quality, maxBytes);
    const b = this.budget;
    const S = GPUBufferUsage.STORAGE;
    this.counters = dev.createBuffer({ label: 'grass-counters', size: COUNTER_BYTES, usage: S | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST });
    this.chunks = dev.createBuffer({ label: 'grass-chunks', size: b.chunkCap * CHUNK_BYTES, usage: S });
    this.blades = dev.createBuffer({ label: 'grass-blades', size: b.bladeBytes, usage: S });
    this.dispatchArgs = dev.createBuffer({ label: 'grass-dispatch-args', size: 16, usage: S | GPUBufferUsage.INDIRECT });
    this.drawArgs = dev.createBuffer({ label: 'grass-draw-args', size: 48, usage: S | GPUBufferUsage.INDIRECT });
    this.staging = readback ? dev.createBuffer({ label: 'grass-counter-readback', size: COUNTER_BYTES, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }) : null;

    this.genGroup = dev.createBindGroup({
      label: 'grass-gen',
      layout: pipes.genLayout,
      entries: [{ binding: 0, resource: { buffer: params } }, { binding: 1, resource: { buffer: this.counters } }, { binding: 2, resource: { buffer: this.chunks } }, { binding: 3, resource: { buffer: this.blades } },
        { binding: 4, resource: pipes.cover.createView() }],
    });
    this.finGroup = dev.createBindGroup({
      label: 'grass-fin',
      layout: pipes.finLayout,
      entries: [{ binding: 0, resource: { buffer: params } }, { binding: 1, resource: { buffer: this.counters } }, { binding: 2, resource: { buffer: this.dispatchArgs } }, { binding: 3, resource: { buffer: this.drawArgs } }],
    });
    for (let i = 0; i < 3; i++) {
      this.drawGroups.push(dev.createBindGroup({
        label: \`grass-draw-lod\${i}\`,
        layout: pipes.drawLayout,
        entries: [{ binding: 0, resource: { buffer: params } }, { binding: 1, resource: { buffer: this.blades, offset: b.offsets[i], size: b.caps[i] * BLADE_BYTES } }],
      }));
    }
  }

  /** Call from update(): finishes the counter readback started by an earlier frame's encodePre, once that frame was submitted. */
  pollReadback(): void {
    const staging = this.staging;
    if (!staging || !this.copyQueued || this.mapping) return;
    this.copyQueued = false;
    this.mapping = true;
    staging.mapAsync(GPUMapMode.READ).then(() => {
      const c = new Uint32Array(staging.getMappedRange().slice(0));
      staging.unmap();
      this.counts.chunks = c[0];
      this.counts.lod[0] = c[1]; this.counts.lod[1] = c[2]; this.counts.lod[2] = c[3];
      this.counts.patches = c[4];
      this.sampled = true;
      this.mapping = false;
    }, () => { this.mapping = false; });
  }

  encodePre(enc: GPUCommandEncoder, rc: RenderContext): void {
    this.clearCounters(enc);
    const pass = enc.beginComputePass({ label: 'grass-cull' });
    this.encodeCull(pass, rc);
    pass.end();
    this.copyCounters(enc);
  }

  /** Clear before beginning the standalone or shared vegetation compute pass. */
  clearCounters(enc: GPUCommandEncoder): void {
    enc.clearBuffer(this.counters);
  }

  /** The original four dispatches, also usable in the shared vegetation compute pass. */
  encodeCull(pass: GPUComputePassEncoder, rc: RenderContext): void {
    const b = this.budget;
    pass.setBindGroup(0, rc.frame.group);
    pass.setBindGroup(1, rc.world.group);
    pass.setPipeline(this.pipes.patchesPipe);
    pass.setBindGroup(2, this.genGroup);
    pass.dispatchWorkgroups(Math.ceil((b.cellsPerSide * b.cellsPerSide) / 64));
    pass.setPipeline(this.pipes.finDispatchPipe);
    pass.setBindGroup(2, this.finGroup);
    pass.dispatchWorkgroups(1);
    pass.setPipeline(this.pipes.bladesPipe);
    pass.setBindGroup(2, this.genGroup);
    pass.dispatchWorkgroupsIndirect(this.dispatchArgs, 0);
    pass.setPipeline(this.pipes.finDrawPipe);
    pass.setBindGroup(2, this.finGroup);
    pass.dispatchWorkgroups(1);
  }

  /** Optional dev readback; call after the compute pass has ended. */
  copyCounters(enc: GPUCommandEncoder): void {
    if (this.staging && !this.copyQueued && !this.mapping && ++this.sinceSample >= 30) {
      this.sinceSample = 0;
      enc.copyBufferToBuffer(this.counters, 0, this.staging, 0, COUNTER_BYTES);
      this.copyQueued = true;
    }
  }

  encodeGBuffer(pass: GPURenderPassEncoder | GPURenderBundleEncoder): void {
    for (let i = 0; i < 3; i++) {
      pass.setPipeline(this.pipes.drawPipes[i]);
      pass.setBindGroup(2, this.drawGroups[i]);
      pass.drawIndirect(this.drawArgs, i * 16);
    }
  }

  destroy(): void {
    for (const buf of [this.counters, this.chunks, this.blades, this.dispatchArgs, this.drawArgs, this.staging]) buf?.destroy();
  }
}

`,Ex=`import type { ObstacleCollider, Vec3 } from '../../contracts';
import { isExtreme, type FrameInfo, type RenderContext, type RenderModule, type SceneData } from '../contracts';
import { RT_CAMERA_RERANK, RT_CAMERA_WITHIN, buildColliders, buildRtProxies, cameraShare, forestRtCap } from './colliders';
import { FarCanopy, FarCanopyPipeline } from './farCanopy';
import { GrassPipelines, GrassSystem } from './grass';
import { packInstances } from './instanceData';
import { FAR_TIER, FAR_UNCOVERED_NEAR, VEG_PARAM_BYTES, TREE_TIER, createParamViews, packVegParams } from './params';
import { REGION_RADIUS, TIER_LIMITS, placeVegetation, type VegPlacement } from './placement';
import { diffPlans, vegPlan, type VegPlan } from './placementPlan';
import { COARSE } from './region';
import { TreeAssets } from './treeAssets';
import { placeFarForest } from './treePlanFar';
import { TreeSystem } from './treeSystem';
import { DRAW_COUNT } from './variants';
import { VegetationRenderBundle } from './renderBundle';
import { parkCanopyProxies, parkWoodProxies, prependParkPlantings, tierPlantCount } from './parkPlanting';
import { publishCanopyShadowOf, publishForestFloor } from './forestFloor';

export interface VegetationStats {
  /** Grass blades appended by the last sampled cull, all LODs. Null until the first async counter readback (dev builds only). */
  grassInstances: number | null;
  grassPatches: number | null;
  grassLod: [number, number, number] | null;
  /** Instance capacity of the grass buffer, all LODs, and its size in bytes. */
  grassCapacity: number;
  grassBytes: number;
  /** Placed trees, bushes and rocks for the current quality tier (a tier is an exact prefix of the ultra placement). */
  trees: number;
  bushes: number;
  rocks: number;
  /** Trees and bushes / rocks drawn per LOD in the last sampled cull; null until the first readback (dev builds only). */
  treeLod: [number, number, number] | null;
  rockLod: [number, number, number] | null;
  /** Instance slots and GPU bytes of the tree and rock buffers, and the static mesh bytes shared by all tiers. */
  treeSlots: number;
  treeBytes: number;
  meshBytes: number;
  /** Triangles of every (variant, LOD) mesh, variant-major (12 variants x 3 LODs). */
  meshTriangles: number[];
  colliders: number;
  rtPrimitives: number;
  /** Far-field canopy cards (billboards for trees beyond the real-tree draw distance and over ground the tree cap left bare): placed, of those over bare ground, GPU bytes and the triangles drawn at most (2 per card). */
  farCards: number;
  farUncovered: number;
  farBytes: number;
  farTriangles: number;
}

export type VegetationModule = RenderModule & {
  /** Feeds the prop wash and trample bend for this frame (call every frame; otherwise the wash follows FrameInfo.quad). */
  setQuad(pos: Vec3, vel: Vec3, thrust: number): void;
  setWind(dirXZ: [number, number], speed: number): void;
  /** Trunk boxes of the trees along the racing line and boulders next to it; a fresh array of the same deterministic boxes each call. */
  vegetationColliders(): ObstacleCollider[];
  stats(): VegetationStats;
};

const THRUST_PER_OMEGA2 = 1.1e-6;
const DEFAULT_WIND_DIR: [number, number] = [0.8, 0.6];
const DEFAULT_WIND_SPEED = 4;

export function createVegetationModule(): VegetationModule {
  const views = createParamViews();
  const wind = { dir: [DEFAULT_WIND_DIR[0], DEFAULT_WIND_DIR[1]] as [number, number], speed: DEFAULT_WIND_SPEED };
  const quadIn = { pos: [0, 0, 0] as Vec3, vel: [0, 0, 0] as Vec3, thrust: 0 };
  const quadUse = { pos: [0, 0, 0] as Vec3, vel: [0, 0, 0] as Vec3, thrust: 0 };
  let quadPending = false;
  const renderBundle = new VegetationRenderBundle();
  const drawVegetation = (pass: GPURenderBundleEncoder): void => {
    grass?.encodeGBuffer(pass);
    trees?.encodeGBuffer(pass);
    far?.encodeGBuffer(pass);
  };
  const camXZ: [number, number] = [0, 0];
  const devReadback = import.meta.env.DEV;

  let scene: SceneData | null = null;
  let paramsBuf: GPUBuffer | null = null;
  let grass: GrassSystem | null = null;
  let grassPipes: GrassPipelines | null = null;
  let assets: TreeAssets | null = null;
  let assetsPending = false;
  let trees: TreeSystem | null = null;
  let far: FarCanopy | null = null;
  let farPipe: FarCanopyPipeline | null = null;
  let farUncovered = 0;
  let built: VegPlan | null = null;
  let place: VegPlacement | null = null;
  let parkPlantCount = 0;
  let colliders: ObstacleCollider[] = [];
  let rtCount = 0;
  /** The forest alone (before the park plantings are merged in), the cap its RT proxies were built for and the registry version seen then. */
  let forestPlace: VegPlacement | null = null;
  let rtCap = -1, rtSeen = -1, rtExtreme = false;
  /** Plants and rocks the race-line set has (proxyKey), the camera set's budget, and where the camera was when its set was last ranked. */
  let lineTaken = new Set<number>();
  let cameraTaken = new Set<number>();
  let cameraBudget = 0;
  /** The tree slot of each placed plant (park plantings first), from the last instance pack. */
  let plantSlots: Uint32Array | null = null;

  /**
   * Tells the tree shader which trees have GI proxies (park plantings, the race-line set, the camera's round): the others have nothing for
   * the GI rays from their leaves to hit, so they take their crown's full baked occlusion (tree.wgsl crownAo).
   */
  function publishProxied(ctx: RenderContext): void {
    if (!trees || !plantSlots) return;
    const bits = new Uint32Array(Math.ceil(trees.slots / 32));
    plantSlots.forEach((slot, j) => {
      const forest = j - parkPlantCount;
      if (forest < 0 || lineTaken.has(forest) || cameraTaken.has(forest)) bits[slot >> 5] |= 1 << (slot & 31);
    });
    trees.setProxied(ctx, bits);
  }
  let cameraFocus: Vec3 | null = null;
  let treeCount = 0, bushCount = 0, rockCount = 0;
  const treeParams = { ...TREE_TIER.medium, slots: 0, draws: DRAW_COUNT };

  /**
   * The vegetation's RT proxies: the park plantings' and, within what the other static groups (park, track) leave under MAX_PRIMS, the
   * forest's: about the start at ultra and below; at the extreme tier every plant along the race line (static), plus the plants round the
   * camera that the line set leaves out (a dynamic group, re-ranked every RT_CAMERA_RERANK metres, so lone trees and views off the line
   * are covered too and moving it never rebuilds the static tree). Rebuilt when the tier or the other groups change the budget.
   */
  function publishRt(ctx: RenderContext, camera?: Vec3): void {
    if (!scene || !forestPlace) return;
    const extreme = isExtreme(ctx.quality);
    if (ctx.rt.version !== rtSeen || extreme !== rtExtreme) {
      const parkProxies = [...parkCanopyProxies(scene.park?.park.plantings), ...parkWoodProxies(scene.park?.park.plantings)];
      const cap = forestRtCap(extreme, ctx.rt.allStatic().length - rtCount + parkProxies.length);
      const camera = extreme ? cameraShare(cap) : 0, line = cap - camera;
      if (line !== rtCap || extreme !== rtExtreme) {
        rtCap = line; rtExtreme = extreme; cameraBudget = camera; cameraFocus = null;
        lineTaken = new Set<number>();
        const proxies = buildRtProxies(forestPlace, sceneFocus(scene), line, { alongLine: extreme, taken: lineTaken });
        proxies.push(...parkProxies);
        rtCount = proxies.length;
        ctx.rt.setStatic('vegetation', proxies);
        if (!extreme) { ctx.rt.remove('vegetation-camera'); cameraTaken = new Set<number>(); }
        publishProxied(ctx);
      }
    }
    if (extreme && cameraBudget > 0 && camera && (!cameraFocus || Math.hypot(camera[0] - cameraFocus[0], camera[2] - cameraFocus[2]) > RT_CAMERA_RERANK)) {
      cameraFocus = [camera[0], camera[1], camera[2]];
      cameraTaken = new Set<number>();
      ctx.rt.setDynamic('vegetation-camera', buildRtProxies(forestPlace, cameraFocus, cameraBudget, { within: RT_CAMERA_WITHIN, skip: lineTaken, taken: cameraTaken }));
      publishProxied(ctx);
    }
    rtSeen = ctx.rt.version;
  }

  function rebuildGrass(ctx: RenderContext): void {
    renderBundle.invalidate();
    grass?.destroy();
    grass = paramsBuf && grassPipes ? new GrassSystem(ctx, grassPipes, paramsBuf, devReadback) : null;
  }

  function rebuildTrees(ctx: RenderContext): void {
    renderBundle.invalidate();
    trees?.destroy();
    trees = null;
    treeCount = bushCount = rockCount = 0;
    if (!paramsBuf || !assets || !place) return;
    const limits = TIER_LIMITS[ctx.quality.tier];
    const plantCount = tierPlantCount(place, limits.plants, parkPlantCount);
    const rocks = Math.min(limits.rocks, place.rocks.count);
    for (let i = 0; i < plantCount; i++) {
      if (assets.variants[place.plants.variant[i]].def.group === 'tree') treeCount++;
      else bushCount++;
    }
    rockCount = rocks;
    const packed = packInstances([{ set: place.plants, count: plantCount }, { set: place.rocks, count: rocks }], assets.variants);
    trees = new TreeSystem(ctx, assets, paramsBuf, packed, devReadback);
    plantSlots = packed.runSlots[0];
    publishProxied(ctx);
  }

  function rebuildFar(ctx: RenderContext): void {
    renderBundle.invalidate();
    far?.destroy();
    far = null;
    farUncovered = 0;
    if (!paramsBuf || !farPipe || !place || !scene) return;
    const q = ctx.quality;
    const limits = TIER_LIMITS[q.tier];
    // The real trees are a nearest-first prefix: complete out to the walk ring of their last tree (or the whole region when the cap was not reached).
    const n = tierPlantCount(place, limits.plants, parkPlantCount);
    const coveredRing = n - parkPlantCount < limits.plants ? REGION_RADIUS : place.plantRing[n - 1] - COARSE;
    const forest = placeFarForest(scene.terrain, scene.track, { cap: FAR_TIER[q.tier].cards, radius: q.terrainViewDistance, coveredRing, uncoveredNear: FAR_UNCOVERED_NEAR });
    farUncovered = forest.uncovered;
    far = new FarCanopy(ctx, farPipe, paramsBuf, forest);
  }

  function currentQuad(f: FrameInfo): typeof quadUse | null {
    if (quadPending) {
      quadPending = false;
      quadUse.pos = quadIn.pos; quadUse.vel = quadIn.vel; quadUse.thrust = quadIn.thrust;
      return quadUse;
    }
    const q = f.quad;
    if (!q) return null;
    const w = q.motorOmega;
    quadUse.pos = q.pos;
    quadUse.vel = q.vel;
    quadUse.thrust = q.armed ? THRUST_PER_OMEGA2 * (w[0] * w[0] + w[1] * w[1] + w[2] * w[2] + w[3] * w[3]) : 0;
    return quadUse;
  }

  function sceneFocus(s: SceneData): Vec3 {
    if (s.track) return s.track.start.pos;
    const t = s.terrain, extent = (t.resolution - 1) * t.cellSize;
    return [t.origin[0] + extent / 2, 0, t.origin[1] + extent / 2];
  }

  const mod: VegetationModule = {
    name: 'vegetation',

    async init(ctx: RenderContext) {
      renderBundle.invalidate();
      paramsBuf = ctx.device.createBuffer({ label: 'vegetation-params', size: VEG_PARAM_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      // The far-canopy and grass pipelines start compiling before the trees load, the trees' once they have; ready() waits for all of them.
      farPipe = new FarCanopyPipeline(ctx);
      grassPipes = new GrassPipelines(ctx);
      assets = await TreeAssets.create(ctx);
      built = vegPlan(ctx.quality);
      rebuildGrass(ctx);
    },

    async ready() {
      await Promise.all([assets?.ready, farPipe?.ready, grassPipes?.ready]);
    },

    setScene(ctx: RenderContext, s: SceneData) {
      scene = s;
      place = placeVegetation(s.terrain, s.track, TIER_LIMITS.ultra);
      // Park trunks have authoritative per-limb collision in ParkRuntime. Build
      // forest boxes before adding its explicit trees, avoiding duplicate boxes.
      colliders = buildColliders(place);
      grassPipes?.setCover(publishForestFloor(s.terrain, place, s.track));
      forestPlace = place;
      rtCap = -1;
      publishRt(ctx);
      const merged = prependParkPlantings(place, s.park?.park.plantings);
      place = merged.placement; parkPlantCount = merged.count;
      publishCanopyShadowOf(s.terrain, place);
      const now = vegPlan(ctx.quality);
      built = built ? { ...now, grassBladesPerM2: built.grassBladesPerM2, grassDistance: built.grassDistance } : now;
      rebuildTrees(ctx);
      rebuildFar(ctx);
    },

    update(ctx: RenderContext, f: FrameInfo) {
      if (!paramsBuf || !scene) return;
      // Compared on the resolved profile, not the tier: Performance 240 keeps the tier but thins the grass.
      const now = vegPlan(ctx.quality);
      const redo = diffPlans(built, now);
      built = now;
      // Entering or leaving the extreme tier swaps the tree meshes for the dense-crowned set (or back); the old ones draw until the new are built.
      if (assets && !assetsPending && assets.dense !== isExtreme(ctx.quality)) {
        assetsPending = true;
        // Swapped in once its pipelines have compiled too (TreeAssets.ready): the old meshes draw until then.
        void TreeAssets.create(ctx).then((next) => next.ready.then(() => next)).then((next) => {
          assetsPending = false;
          if (!paramsBuf) { next.destroy(); return; }
          const old = assets;
          assets = next;
          rebuildTrees(ctx);
          old?.destroy();
        }, () => { assetsPending = false; });
      }
      publishRt(ctx, f.camera.pos);
      if (redo.grass) rebuildGrass(ctx);
      if (redo.trees) rebuildTrees(ctx);
      if (redo.far) rebuildFar(ctx);
      if (!grass) return;
      grass.pollReadback();
      trees?.pollReadback();
      const t = scene.terrain;
      camXZ[0] = f.camera.pos[0]; camXZ[1] = f.camera.pos[2];
      Object.assign(treeParams, TREE_TIER[ctx.quality.tier]);
      treeParams.slots = trees ? trees.slots : 0;
      packVegParams(views, {
        windDir: wind.dir,
        windSpeed: wind.speed,
        parkRadius: scene.track?.parkMap?.radius ?? 0,
        quad: currentQuad(f),
        budget: grass.budget,
        waterLevel: t.waterLevel,
        seed: t.seed,
        cameraXZ: camXZ,
        tree: treeParams,
        farDistance: built ? built.farDistance : 0,
      });
      ctx.device.queue.writeBuffer(paramsBuf, 0, views.u32);
    },

    encodePre(enc: GPUCommandEncoder, ctx: RenderContext) {
      if (!scene) return;
      if (grass && trees && trees.slots > 0) {
        // Their writable buffers are disjoint; clear both before the shared pass and keep every
        // dispatch in its original order. Dev-only copies can follow both systems' dispatches.
        grass.clearCounters(enc);
        trees.clearCounters(enc);
        const pass = enc.beginComputePass({ label: 'vegetation-cull' });
        grass.encodeCull(pass, ctx);
        trees.encodeCull(pass, ctx);
        pass.end();
        grass.copyCounters(enc);
        trees.copyCounters(enc);
        return;
      }
      grass?.encodePre(enc, ctx);
      trees?.encodePre(enc, ctx);
    },

    encodeGBuffer(pass: GPURenderPassEncoder, ctx: RenderContext) {
      if (!scene) return;
      renderBundle.encode(pass, ctx, drawVegetation);
    },

    setQuad(pos: Vec3, vel: Vec3, thrust: number) {
      quadIn.pos = pos; quadIn.vel = vel; quadIn.thrust = thrust;
      quadPending = true;
    },

    setWind(dirXZ: [number, number], speed: number) {
      wind.dir[0] = dirXZ[0]; wind.dir[1] = dirXZ[1]; wind.speed = speed;
    },

    vegetationColliders(): ObstacleCollider[] {
      return colliders.slice();
    },

    stats(): VegetationStats {
      const c = grass?.counts;
      const sampled = !!grass && grass.sampled;
      const tc = trees?.counts;
      const treesSampled = !!trees && trees.sampled;
      return {
        grassInstances: sampled && c ? c.lod[0] + c.lod[1] + c.lod[2] : null,
        grassPatches: sampled && c ? c.patches : null,
        grassLod: sampled && c ? [c.lod[0], c.lod[1], c.lod[2]] : null,
        grassCapacity: grass ? grass.budget.caps[0] + grass.budget.caps[1] + grass.budget.caps[2] : 0,
        grassBytes: grass ? grass.budget.bladeBytes : 0,
        trees: treeCount,
        bushes: bushCount,
        rocks: rockCount,
        treeLod: treesSampled && tc ? [tc.plantLod[0], tc.plantLod[1], tc.plantLod[2]] : null,
        rockLod: treesSampled && tc ? [tc.rockLod[0], tc.rockLod[1], tc.rockLod[2]] : null,
        treeSlots: trees ? trees.slots : 0,
        treeBytes: trees ? trees.bufferBytes : 0,
        meshBytes: assets ? assets.vertexBytes + assets.indexBytes : 0,
        meshTriangles: assets ? assets.triangles.slice() : [],
        colliders: colliders.length,
        rtPrimitives: rtCount,
        farCards: far ? far.cards : 0,
        farUncovered,
        farBytes: far ? far.bytes : 0,
        farTriangles: far ? 2 * far.cards : 0,
      };
    },

    destroy() {
      renderBundle.invalidate();
      grass?.destroy();
      trees?.destroy();
      far?.destroy();
      assets?.destroy();
      paramsBuf?.destroy();
      grass = null;
      trees = null;
      far = null;
      assets = null;
      farPipe = null;
      grassPipes = null;
      paramsBuf = null;
    },
  };
  return mod;
}
`,Dx=`import type { InstanceSet } from './placement';
import { VARIANT_COUNT, variantPlan, type VariantAsset } from './variants';

export const INSTANCE_BYTES = 32;
export const VARIANT_BYTES = 80;
/** Every variant's instances start at a multiple of this many slots so a visible-list binding offset is 256-byte aligned. */
export const SLOT_ALIGN = 64;
export const KIND_TREE = 0;
export const KIND_BUSH = 1;
export const KIND_ROCK = 2;

const INSTANCE_WORDS = INSTANCE_BYTES / 4;
const VARIANT_WORDS = VARIANT_BYTES / 4;

export interface PackedInstances {
  /** Instance slots including alignment padding; a multiple of SLOT_ALIGN. */
  slots: number;
  /** Instance structs, \`slots\` x 32 bytes (layout: shaders/vegetation/veg_instance.wgsl). Padding slots have scale 0. */
  instances: ArrayBuffer;
  /** Variant table, VARIANT_COUNT x 80 bytes. */
  variants: ArrayBuffer;
  /** Per variant: first slot and instance count. */
  first: Uint32Array;
  count: Uint32Array;
  /** Per run, the slot each of its instances went to. */
  runSlots: Uint32Array[];
}

export interface InstanceRun {
  set: InstanceSet;
  /** Only the first \`count\` instances of the set are used (tier prefixes). */
  count: number;
}

const kindOf = (group: string): number => (group === 'tree' ? KIND_TREE : group === 'bush' ? KIND_BUSH : KIND_ROCK);

/**
 * Sorts the instances by variant (stable, so equal input gives an identical buffer), aligns each variant's run to SLOT_ALIGN slots
 * and writes the instance structs and the variant table the tree and rock shaders read.
 */
export function packInstances(runs: readonly InstanceRun[], assets: readonly VariantAsset[]): PackedInstances {
  const count = new Uint32Array(VARIANT_COUNT);
  for (const r of runs) for (let i = 0; i < r.count; i++) count[r.set.variant[i]]++;
  const first = new Uint32Array(VARIANT_COUNT);
  let slots = 0;
  for (let v = 0; v < VARIANT_COUNT; v++) {
    first[v] = slots;
    slots += Math.ceil(count[v] / SLOT_ALIGN) * SLOT_ALIGN;
  }

  const instances = new ArrayBuffer(Math.max(slots, SLOT_ALIGN) * INSTANCE_BYTES);
  const f32 = new Float32Array(instances), u32 = new Uint32Array(instances);
  const fill = new Uint32Array(VARIANT_COUNT);
  const runSlots: Uint32Array[] = [];
  for (const r of runs) {
    const s = r.set, slotOf = new Uint32Array(r.count);
    runSlots.push(slotOf);
    for (let i = 0; i < r.count; i++) {
      const v = s.variant[i];
      const slot = first[v] + fill[v]++, o = slot * INSTANCE_WORDS;
      slotOf[i] = slot;
      f32[o] = s.pos[i * 3]; f32[o + 1] = s.pos[i * 3 + 1]; f32[o + 2] = s.pos[i * 3 + 2];
      f32[o + 3] = s.scale[i];
      f32[o + 4] = s.yaw[i];
      u32[o + 5] = v; u32[o + 6] = s.tint[i]; u32[o + 7] = s.nrm[i];
    }
  }

  const variants = new ArrayBuffer(VARIANT_COUNT * VARIANT_BYTES);
  const vf = new Float32Array(variants), vu = new Uint32Array(variants);
  for (let v = 0; v < VARIANT_COUNT; v++) {
    const a = assets[v], d = a.def, o = v * VARIANT_WORDS;
    vu[o] = first[v]; vu[o + 1] = count[v]; vu[o + 2] = kindOf(d.group);
    vf[o + 4] = a.centreY; vf[o + 5] = a.radius; vf[o + 6] = d.lodRatio[0]; vf[o + 7] = d.lodRatio[1];
    vf[o + 8] = a.height; vf[o + 9] = d.swayHz; vf[o + 10] = d.swayStrength; vf[o + 11] = d.flutter;
    vf[o + 12] = d.tone[0]; vf[o + 13] = d.tone[1]; vf[o + 14] = d.tone[2]; vf[o + 15] = d.translucency;
    // The crown ellipsoid (centre height and radii, mesh metres) for the leaves' sunflecks (tree.wgsl); zero for rocks.
    const plan = variantPlan(v);
    if (plan) { vf[o + 16] = plan.crownC[1]; vf[o + 17] = plan.crownR[0]; vf[o + 18] = plan.crownR[1]; vf[o + 19] = plan.crownR[2]; }
  }
  return { slots, instances, variants, first, count, runSlots };
}
`,Ox=`import { Rng } from '../../world/track/rng';
import {
  beechPainter, birchPainter, blobPainter, hawthornPainter, newSample, sat, sheetPainter, shrubPainter, sprigPainter, type LaidOutPainter, type Painter, type ShootLayout,
} from './treeLeafShapes';
import { runSliced, runSync, type Steps } from './slices';
import { brushPainter, conifer, pinePainter, sprayPainter, type SprayLayout } from './treeNeedleShapes';

export const TILE_SIZE = 512;
export const TILES_X = 4;
export const TILES_Y = 5;
export const ATLAS_W = TILE_SIZE * TILES_X;
export const ATLAS_H = TILE_SIZE * TILES_Y;
/** Mips are kept down to 4 x 4 texels per tile so bilinear taps never reach a neighbouring tile's shape. */
export const ATLAS_MIPS = 8;
/** Tile size of the extreme tier's atlas: twice the texels each way, so a leaf a metre from the camera stays sharp. */
export const EXTREME_TILE_SIZE = 1024;

/** Mip levels of an atlas with \`tileSize\` texels per tile side (down to 4 x 4 per tile). */
export const atlasMips = (tileSize: number): number => Math.round(Math.log2(tileSize / 4)) + 1;
/**
 * Tile indices: 4 x 5 tiles, tile = column + 4 * row from the top-left. Oak, birch and beech have two shoots each (\`sprig\` and \`oak2\`,
 * \`birch\` and \`birch2\`, \`beech\` and \`beech2\`) so neighbouring cards of one crown differ, and bushes mix hazel (\`shrub\`) and \`hawthorn\`;
 * \`pine\` is a Scots pine branch end of three or four needle brushes and \`pine2\` a single one (the near LOD's pine shoots), \`needles\` and \`needles2\` flat spruce sprays, and \`brush\` and \`brush2\` the hanging
 * bottle-brush branchlets of a spruce. The last row holds single-leaf sheets of oak, birch, beech and hazel, which the extreme tier cuts its
 * per-leaf geometry from (treeLeafShapes.ts sheetPainter).
 */
export const TILE = { sprig: 0, needles: 1, blob: 2, conifer: 3, birch: 4, shrub: 5, oak2: 6, birch2: 7, pine: 8, beech: 9, beech2: 10, hawthorn: 11,
  brush: 12, brush2: 13, pine2: 14, needles2: 15, oakSheet: 16, birchSheet: 17, beechSheet: 18, hazelSheet: 19 } as const;
export const TILE_COUNT = 20;
/** The colour texture stores the leaf colour multiplier divided by this; the tree shader multiplies it back. */
export const COLOUR_RANGE = 3;

/** One painter sample per texel: the alpha cut of the bilinear-filtered mask already gives smooth leaf edges. */
const SS = 1;
const ALPHA_CUT = 128;

/** Atlas rectangle of a tile: u0, v0 (top edge), u1, v1 (bottom edge). */
export function tileRect(tile: number): [number, number, number, number] {
  const col = tile % TILES_X, row = Math.floor(tile / TILES_X);
  return [col / TILES_X, row / TILES_Y, (col + 1) / TILES_X, (row + 1) / TILES_Y];
}

/**
 * Colour multiplier relative to the species' green leaf tone for a painter hue (0 deep green, 0.35 yellow-green, 0.7 yellow-orange,
 * 1 dead brown) and shade. Real leaf reflectance has red about half of green and blue under a third; the ramp keeps those ratios.
 */
const RAMP: readonly (readonly [number, number, number, number])[] = [
  [0, 0.9, 0.9, 1], [0.35, 1.55, 1.1, 0.75], [0.7, 2.3, 1, 0.6], [1, 2.4, 0.78, 0.9],
];

export function leafColour(hue: number, shade: number, out: [number, number, number]): void {
  let i = 0;
  while (i < RAMP.length - 2 && hue > RAMP[i + 1][0]) i++;
  const a = RAMP[i], b = RAMP[i + 1], t = sat((hue - a[0]) / (b[0] - a[0]));
  const dead = 1 - 0.3 * sat((hue - 0.8) / 0.2);
  for (let k = 0; k < 3; k++) out[k] = (a[k + 1] + (b[k + 1] - a[k + 1]) * t) * shade * dead;
}

interface Level {
  /** rgb = colour multiplier / COLOUR_RANGE, a = coverage mask. */
  colour: Uint8Array;
  /** r, g = surface tilt along the tile's u and v (0.5 flat), b = translucency (thin lamina 1, veins 0), a = cavity openness. */
  data: Uint8Array;
}

/** The procedural leaf atlas: two RGBA8 pyramids of atlasMips(tileSize) levels (level l is (tileSize * TILES_X >> l) x (tileSize * TILES_Y >> l) texels). */
export interface LeafAtlas {
  tileSize: number;
  colour: Uint8Array[];
  data: Uint8Array[];
}

/** Painted channels per sample: colour rgb, tilt u and v, translucency, openness. */
const CHANNELS = 7;
const STRIDE = CHANNELS + 1;
/** A rasterise or downsample generator yields every ROWS_PER_STEP + 1 rows (a power of two minus one mask). */
const ROWS_PER_STEP = 3;
const byte = (x: number): number => Math.round(sat(x) * 255);

function* rasterise(paint: Painter, tile: number, out: Level, TILE_SIZE: number): Steps<void> {
  const ATLAS_W = TILE_SIZE * TILES_X;
  const ox = (tile % TILES_X) * TILE_SIZE, oy = Math.floor(tile / TILES_X) * TILE_SIZE;
  const s = newSample(), c: [number, number, number] = [0, 0, 0];
  const sum = new Float64Array(CHANNELS), mean = new Float64Array(CHANNELS);
  let covered = 0;
  const texel = new Float32Array(TILE_SIZE * TILE_SIZE * STRIDE);
  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      sum.fill(0);
      let cover = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          if (!paint((x + (sx + 0.5) / SS) / TILE_SIZE, (y + (sy + 0.5) / SS) / TILE_SIZE, s)) continue;
          leafColour(s.hue, s.shade, c);
          cover++;
          sum[0] += c[0]; sum[1] += c[1]; sum[2] += c[2]; sum[3] += s.tu; sum[4] += s.tv; sum[5] += s.thin; sum[6] += s.open;
        }
      }
      const o = (y * TILE_SIZE + x) * STRIDE;
      texel[o] = cover / (SS * SS);
      if (cover === 0) continue;
      covered++;
      for (let k = 0; k < CHANNELS; k++) { texel[o + 1 + k] = sum[k] / cover; mean[k] += texel[o + 1 + k]; }
    }
    if ((y & ROWS_PER_STEP) === ROWS_PER_STEP) yield;
  }
  // Empty texels take the tile's mean so bilinear taps and mips at a leaf edge never blend toward black.
  const fill = Array.from(mean, (m) => (covered > 0 ? m / covered : 0));
  if (covered === 0) { fill[0] = fill[1] = fill[2] = 0.7; fill[5] = 1; fill[6] = 1; }
  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      const t = (y * TILE_SIZE + x) * STRIDE, a = texel[t];
      const v = (k: number): number => (a > 0 ? texel[t + 1 + k] : fill[k]);
      const o = ((oy + y) * ATLAS_W + ox + x) * 4;
      out.colour[o] = byte(v(0) / COLOUR_RANGE); out.colour[o + 1] = byte(v(1) / COLOUR_RANGE); out.colour[o + 2] = byte(v(2) / COLOUR_RANGE);
      out.colour[o + 3] = Math.round(a * 255);
      out.data[o] = byte(0.5 + 0.5 * v(3)); out.data[o + 1] = byte(0.5 + 0.5 * v(4)); out.data[o + 2] = byte(v(5)); out.data[o + 3] = byte(v(6));
    }
    if ((y & ROWS_PER_STEP) === ROWS_PER_STEP) yield;
  }
}

/** Fraction of a tile's texels at or above the alpha cut, after scaling alpha by \`scale\`. */
export function tileCoverage(colour: Uint8Array, width: number, height: number, tile: number, scale = 1): number {
  const tw = width / TILES_X, th = height / TILES_Y, ox = (tile % TILES_X) * tw, oy = Math.floor(tile / TILES_X) * th;
  let n = 0;
  for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) if (colour[((oy + y) * width + ox + x) * 4 + 3] * scale >= ALPHA_CUT) n++;
  return n / (tw * th);
}

/** Box-filtered next mip: every channel weighted by alpha, then alpha rescaled per tile so alpha-tested coverage matches level 0 (leaves keep their mass at distance). */
function* downsample(src: Level, w: number, h: number, target: readonly number[]): Steps<Level> {
  const hw = w >> 1, hh = h >> 1;
  const dst: Level = { colour: new Uint8Array(hw * hh * 4), data: new Uint8Array(hw * hh * 4) };
  const acc = new Float64Array(7);
  for (let y = 0; y < hh; y++) {
    for (let x = 0; x < hw; x++) {
      let a = 0, weight = 0;
      acc.fill(0);
      for (let k = 0; k < 4; k++) {
        const o = ((2 * y + (k >> 1)) * w + 2 * x + (k & 1)) * 4;
        const al = src.colour[o + 3] + 0.5;
        a += src.colour[o + 3];
        weight += al;
        for (let c = 0; c < 3; c++) { acc[c] += src.colour[o + c] * al; acc[3 + c] += src.data[o + c] * al; }
        acc[6] += src.data[o + 3] * al;
      }
      const o = (y * hw + x) * 4;
      for (let c = 0; c < 3; c++) { dst.colour[o + c] = Math.round(acc[c] / weight); dst.data[o + c] = Math.round(acc[3 + c] / weight); }
      dst.data[o + 3] = Math.round(acc[6] / weight);
      dst.colour[o + 3] = Math.round(a / 4);
    }
    if ((y & 15) === 15) yield;
  }
  for (let tile = 0; tile < TILE_COUNT; tile++) {
    let lo = 1, hi = 8;
    for (let it = 0; it < 14; it++) {
      const mid = 0.5 * (lo + hi);
      if (tileCoverage(dst.colour, hw, hh, tile, mid) < target[tile]) lo = mid; else hi = mid;
      yield;
    }
    const tw = hw / TILES_X, th = hh / TILES_Y, ox = (tile % TILES_X) * tw, oy = Math.floor(tile / TILES_X) * th;
    for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
      const o = ((oy + y) * hw + ox + x) * 4 + 3;
      dst.colour[o] = Math.min(255, Math.round(dst.colour[o] * hi));
    }
  }
  return dst;
}

/** The painters in tile order; each tile gets its own sub-stream so changing one leaf shape leaves the others untouched. */
function painters(tileSize: number): Painter[] {
  return Array.from({ length: TILE_COUNT }, (_, tile) => painterFor(tile, tileSize));
}

/** The painter of one tile, built alone. */
function painterFor(tile: number, tileSize: number): LaidOutPainter {
  const rng = (k: number): Rng => new Rng(0x1eaf + k * 7919);
  const make: (() => LaidOutPainter)[] = [
    () => sprigPainter(rng(0)), () => sprayPainter(rng(1), tileSize), () => blobPainter(rng(2)), () => conifer(23), () => birchPainter(rng(4)),
    () => shrubPainter(rng(5)), () => sprigPainter(rng(6)), () => birchPainter(rng(7)), () => pinePainter(rng(8), tileSize), () => beechPainter(rng(9)),
    () => beechPainter(rng(10)), () => hawthornPainter(rng(11)), () => brushPainter(rng(12), tileSize), () => brushPainter(rng(13), tileSize),
    () => pinePainter(rng(14), tileSize, true), () => sprayPainter(rng(15), tileSize),
    () => sheetPainter(rng(16), 'oak'), () => sheetPainter(rng(17), 'birch'), () => sheetPainter(rng(18), 'beech'), () => sheetPainter(rng(19), 'hazel'),
  ];
  return make[tile]();
}

const BROADLEAF_SHOOTS = new Set<number>([TILE.sprig, TILE.oak2, TILE.birch, TILE.birch2, TILE.beech, TILE.beech2, TILE.shrub, TILE.hawthorn]);
const layouts = new Map<number, ShootLayout | null>();

/** Leaves and twigs of a broadleaf shoot tile in tile coordinates (the same at every tile size), null for other tiles. Deterministic. */
export function shootLayout(tile: number): ShootLayout | null {
  if (!layouts.has(tile)) layouts.set(tile, BROADLEAF_SHOOTS.has(tile) ? painterFor(tile, TILE_SIZE).layout ?? null : null);
  return layouts.get(tile) ?? null;
}

const opacity = new Map<string, (u: number, v: number) => boolean>();
const OPACITY_RES = 128;
/**
 * Whether a tile paints anything at an atlas uv inside it (the same shapes at every tile size), or with \`grow\` > 0 whether it paints anything
 * within that many cells (1/128 of the tile) of it. Used to keep foliage from crossing itself.
 */
export function tileOpacity(tile: number, grow = 0): (u: number, v: number) => boolean {
  const key = \`\${tile}:\${grow}\`;
  let f = opacity.get(key);
  if (!f) {
    // Painted once into a coarse mask (a few millimetres per cell on a shoot card); painting per lookup would dominate the tree build.
    const paint = painterFor(tile, TILE_SIZE), s = newSample(), [u0, v0, u1, v1] = tileRect(tile), N = OPACITY_RES;
    let mask = new Uint8Array(N * N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) mask[y * N + x] = paint((x + 0.5) / N, (y + 0.5) / N, s) ? 1 : 0;
    // Grown by a square of cells, one axis at a time.
    for (const [dx, dy] of [[1, 0], [0, 1]]) {
      if (grow <= 0) break;
      const out = new Uint8Array(N * N);
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        for (let k = -grow; k <= grow && !out[y * N + x]; k++) {
          const xx = x + k * dx, yy = y + k * dy;
          if (xx >= 0 && xx < N && yy >= 0 && yy < N && mask[yy * N + xx]) out[y * N + x] = 1;
        }
      }
      mask = out;
    }
    const cell = (t: number): number => Math.min(N - 1, Math.max(0, Math.floor(t * N)));
    const m = mask;
    f = (u, v) => m[cell((v - v0) / (v1 - v0)) * N + cell((u - u0) / (u1 - u0))] === 1;
    opacity.set(key, f);
  }
  return f;
}

const sprays = new Map<number, SprayLayout>();
/** Leader and side shoots of a spruce spray tile (\`needles\` or \`needles2\`) in tile coordinates. Deterministic. */
export function sprayLayout(tile: typeof TILE.needles | typeof TILE.needles2): SprayLayout {
  if (!sprays.has(tile)) sprays.set(tile, sprayPainter(new Rng(0x1eaf + tile * 7919), 64).spray);
  return sprays.get(tile)!;
}

/** Single-leaf sheet a broadleaf shoot tile's leaves are cut from at the extreme tier (hawthorn borrows the lobed oak leaf), null for others. */
export function sheetFor(tile: number): number | null {
  if (tile === TILE.sprig || tile === TILE.oak2 || tile === TILE.hawthorn) return TILE.oakSheet;
  if (tile === TILE.birch || tile === TILE.birch2) return TILE.birchSheet;
  if (tile === TILE.beech || tile === TILE.beech2) return TILE.beechSheet;
  if (tile === TILE.shrub) return TILE.hazelSheet;
  return null;
}

function* atlasSteps(tileSize: number): Steps<LeafAtlas> {
  const W = tileSize * TILES_X, H = tileSize * TILES_Y;
  const base: Level = { colour: new Uint8Array(W * H * 4), data: new Uint8Array(W * H * 4) };
  const paint = painters(tileSize);
  for (let tile = 0; tile < paint.length; tile++) yield* rasterise(paint[tile], tile, base, tileSize);
  const target = Array.from({ length: TILE_COUNT }, (_, t) => tileCoverage(base.colour, W, H, t));
  const levels: Level[] = [base];
  let w = W, h = H;
  for (let l = 1; l < atlasMips(tileSize); l++) {
    levels.push(yield* downsample(levels[l - 1], w, h, target));
    w >>= 1; h >>= 1;
  }
  return { tileSize, colour: levels.map((l) => l.colour), data: levels.map((l) => l.data) };
}

/** The deterministic leaf atlas; level 0 is ATLAS_W x ATLAS_H at the default tile size. */
export function buildLeafAtlas(tileSize = TILE_SIZE): LeafAtlas {
  return runSync(atlasSteps(tileSize));
}

/** The same atlas built in slices of about \`budgetMs\` with an event-loop yield between them, so the loading screen keeps painting. */
export function buildLeafAtlasSliced(budgetMs = 8, yieldFn?: () => Promise<void>, tileSize = TILE_SIZE): Promise<LeafAtlas> {
  return runSliced(atlasSteps(tileSize), budgetMs, yieldFn);
}
`,kx=`import type { Vec3 } from '../../contracts';

/**
 * Vertex kind byte: selects the fragment shader's material (mirrored in shaders/vegetation/tree.wgsl and tree_bark.wgsl). Bark kinds are
 * below 128 and the shader reads the bark type as kind / 8: oak (also bushes), pine, birch, beech, spruce and bare dead wood.
 */
export const KIND = { bark: 0, pineBark: 8, birchBark: 16, beechBark: 24, spruceBark: 32, deadWood: 40, leaf: 128, needle: 160, blob: 192, cone: 224 } as const;
export const VERTEX_STRIDE = 24;
/** A bark vertex's phase byte holds sqrt(radius / BARK_RADIUS_MAX) of its limb at that ring (mirrored in tree_bark.wgsl). */
export const BARK_RADIUS_MAX = 1.2;
export const barkRadiusCode = (radius: number): number => Math.sqrt(Math.min(Math.max(radius, 0) / BARK_RADIUS_MAX, 1));

export interface MeshData {
  vertexCount: number;
  /** xyz per vertex. */
  pos: Float32Array;
  /** Unit normals, xyz per vertex. */
  nrm: Float32Array;
  /** uv per vertex: bark = (around 0..1, metres along the branch / 64), leaves = atlas coordinates. */
  uv: Float32Array;
  /** Per vertex bytes: ambient occlusion, sway weight, kind, phase. */
  attr: Uint8Array;
  idx: Uint32Array;
}

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
export const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

export function norm(a: Vec3): Vec3 {
  const l = len(a);
  return l > 1e-12 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 1, 0];
}

const clamp01 = (x: number): number => Math.min(Math.max(x, 0), 1);
const byte = (x: number): number => Math.round(clamp01(x) * 255);

export interface Vertex {
  p: Vec3;
  n: Vec3;
  u: number;
  v: number;
  ao: number;
  sway: number;
  kind: number;
  phase: number;
}

/** Growable triangle-list accumulator; every vertex carries the full attribute set so tubes and leaf cards share one layout. */
export class MeshBuilder {
  private readonly pos: number[] = [];
  private readonly nrm: number[] = [];
  private readonly uv: number[] = [];
  private readonly attr: number[] = [];
  private readonly idx: number[] = [];

  get vertexCount(): number { return this.pos.length / 3; }
  get triangleCount(): number { return this.idx.length / 3; }

  vertex(x: Vertex): number {
    const n = norm(x.n);
    this.pos.push(x.p[0], x.p[1], x.p[2]);
    this.nrm.push(n[0], n[1], n[2]);
    this.uv.push(x.u, x.v);
    this.attr.push(byte(x.ao), byte(x.sway), x.kind, byte(x.phase));
    return this.pos.length / 3 - 1;
  }

  tri(a: number, b: number, c: number): void {
    this.idx.push(a, b, c);
  }

  quad(a: number, b: number, c: number, d: number): void {
    this.idx.push(a, b, c, a, c, d);
  }

  build(): MeshData {
    return {
      vertexCount: this.vertexCount,
      pos: Float32Array.from(this.pos),
      nrm: Float32Array.from(this.nrm),
      uv: Float32Array.from(this.uv),
      attr: Uint8Array.from(this.attr),
      idx: Uint32Array.from(this.idx),
    };
  }
}

export interface TubeOptions {
  sides: number;
  kind: number;
  /** Sway weight as a function of world height (metres) and progress along the tube (0..1). */
  sway: (y: number, along: number) => number;
  ao: (p: Vec3, along: number) => number;
  /** Metres already spent along the parent, so bark texture runs continuously. */
  v0?: number;
  /** Close the last ring to a point (tapering twigs). */
  tip?: boolean;
  /**
   * Root flare: \`count\` root ridges of relative height \`amp\` (each root its own size, from \`phase\`) that fade out over \`height\` metres above
   * the ground, so the trunk spreads into its roots where it meets the soil.
   */
  buttress?: { count: number; amp: number; height: number; phase: number };
  /** Relative height of low, uneven swellings of the bark (burrs, old healed wounds, an out-of-round section); \`seed\` picks their layout. */
  gnarl?: { amp: number; seed: number };
}

const VSCALE = 1 / 64;
const TAU = Math.PI * 2;

/** Radius multiplier of a root-flare lobe at angle \`ang\` and height \`y\`: narrow ridges where roots leave the trunk, each root its own size. */
function flare(o: NonNullable<TubeOptions['buttress']>, ang: number, y: number): number {
  const fade = Math.exp(-Math.max(y, 0) / o.height);
  if (fade < 1e-3) return 1;
  const k = o.count * ang / TAU + o.phase, i = Math.floor(k), f = k - i;
  // A root is a rounded ridge across the middle of its lobe, sized by a hash of the root's index (wrapping at the seam).
  const size = 0.55 + 0.9 * frac(Math.sin(((i % o.count) + o.count) % o.count * 12.9898 + o.phase * 78.233) * 43758.5453);
  const ridge = Math.pow(Math.max(Math.cos((f - 0.5) * Math.PI), 0), 2.2);
  return 1 + o.amp * fade * (size * ridge - 0.12);
}

const frac = (x: number): number => x - Math.floor(x);

/** Radius multiplier of the gentle swellings of a gnarled trunk: a few periodic waves round the limb that wander along it. */
function gnarled(o: NonNullable<TubeOptions['gnarl']>, ang: number, along: number): number {
  const s = o.seed;
  let g = 0;
  for (let k = 0; k < 3; k++) {
    const turns = 2 + k + Math.floor(frac(s * (k + 1.7)) * 3), wave = 0.6 + 1.7 * frac(s * (k + 3.1)), ph = TAU * frac(s * (k + 5.3));
    g += Math.sin(turns * ang + wave * along + ph) * Math.sin(0.9 * wave * along + 2.1 * ph + k);
  }
  return 1 + o.amp * g / 3;
}

/**
 * Sweeps a ring of \`sides\` vertices along a polyline with parallel-transport frames; \`radii[i]\` is the radius at \`pts[i]\`. Normals come from
 * the swept surface itself, so root flare and swellings shade as solid relief; the phase byte carries the ring's radius for the bark shader.
 */
export function tube(b: MeshBuilder, pts: readonly Vec3[], radii: readonly number[], o: TubeOptions): void {
  const n = pts.length;
  if (n < 2) return;
  const sides = o.sides, ring = sides + 1;
  let t = norm(sub(pts[1], pts[0]));
  const ref: Vec3 = Math.abs(t[1]) < 0.95 ? [0, 1, 0] : [1, 0, 0];
  let nx = norm(cross(t, ref));
  let along = o.v0 ?? 0;
  const pos: Vec3[] = [], radial: Vec3[] = [], alongAt: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(i - 1, 0)], c = pts[Math.min(i + 1, n - 1)];
    const tNew = norm(sub(c, a));
    const proj = dot(nx, tNew);
    nx = norm([nx[0] - tNew[0] * proj, nx[1] - tNew[1] * proj, nx[2] - tNew[2] * proj]);
    t = tNew;
    const bx = cross(t, nx);
    if (i > 0) along += len(sub(pts[i], pts[i - 1]));
    alongAt.push(along);
    const r = o.tip && i === n - 1 ? 0 : radii[i];
    for (let j = 0; j <= sides; j++) {
      const ang = (j % sides / sides) * TAU;
      const cs = Math.cos(ang), sn = Math.sin(ang);
      const dir: Vec3 = [nx[0] * cs + bx[0] * sn, nx[1] * cs + bx[1] * sn, nx[2] * cs + bx[2] * sn];
      let shape = o.buttress ? flare(o.buttress, ang, pts[i][1]) : 1;
      if (o.gnarl) shape *= gnarled(o.gnarl, ang, along);
      radial.push(dir);
      pos.push([pts[i][0] + dir[0] * r * shape, pts[i][1] + dir[1] * r * shape, pts[i][2] + dir[2] * r * shape]);
    }
  }
  const first = b.vertexCount;
  for (let i = 0; i < n; i++) {
    const f = i / (n - 1), radius = o.tip && i === n - 1 ? 0 : radii[i];
    for (let j = 0; j <= sides; j++) {
      const k = i * ring + j, p = pos[k];
      // Surface normal from the neighbouring vertices round the ring and along the limb; a closed tip keeps the radial direction.
      const around = sub(pos[i * ring + (j + 1) % sides], pos[i * ring + (j + sides - 1) % sides]);
      const up = sub(pos[Math.min(i + 1, n - 1) * ring + j], pos[Math.max(i - 1, 0) * ring + j]);
      let nrm = cross(around, up);
      if (len(around) < 1e-7 || len(up) < 1e-7 || dot(nrm, radial[k]) <= 0) nrm = radial[k];
      b.vertex({
        p, n: nrm, u: j / sides, v: Math.min(alongAt[i] * VSCALE, 1),
        ao: o.ao(p, f), sway: o.sway(p[1], f), kind: o.kind, phase: barkRadiusCode(radius),
      });
    }
  }
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < sides; j++) {
      const a = first + i * ring + j, c = first + (i + 1) * ring + j;
      b.quad(a, a + 1, c + 1, c);
    }
  }
}

export interface CardOptions {
  /** Atlas rectangle: u0, v0 (top), u1, v1 (bottom). */
  rect: readonly [number, number, number, number];
  kind: number;
  /** Per-corner normal source: called with the corner position. */
  normalAt: (p: Vec3) => Vec3;
  aoAt: (p: Vec3) => number;
  swayAt: (p: Vec3) => number;
  phase: number;
}

/** Two-triangle sprite centred at \`c\`; \`right\` and \`up\` are half-extent vectors (the sprite's top is +up). */
export function card(b: MeshBuilder, c: Vec3, right: Vec3, up: Vec3, o: CardOptions): void {
  const [u0, v0, u1, v1] = o.rect;
  const corners: [Vec3, number, number][] = [
    [[c[0] - right[0] - up[0], c[1] - right[1] - up[1], c[2] - right[2] - up[2]], u0, v1],
    [[c[0] + right[0] - up[0], c[1] + right[1] - up[1], c[2] + right[2] - up[2]], u1, v1],
    [[c[0] + right[0] + up[0], c[1] + right[1] + up[1], c[2] + right[2] + up[2]], u1, v0],
    [[c[0] - right[0] + up[0], c[1] - right[1] + up[1], c[2] - right[2] + up[2]], u0, v0],
  ];
  const ids = corners.map(([p, u, v]) => b.vertex({ p, n: o.normalAt(p), u, v, ao: o.aoAt(p), sway: o.swayAt(p), kind: o.kind, phase: o.phase }));
  b.quad(ids[0], ids[1], ids[2], ids[3]);
}

/** A leaf card with a stationary vertex at the painted stem base, so wind cannot tear its attachment. */
export function anchoredCard(b: MeshBuilder, anchor: Vec3, right: Vec3, up: Vec3, stemV: number, o: CardOptions): void {
  const center = add(anchor, mul(up, 2 * stemV - 1)), [u0, v0, u1, v1] = o.rect;
  // The painted shoots narrow into a stem below tile v=.92; those empty corners need no triangles.
  const corners = [[1, -0.84, u1, v0 + (v1 - v0) * 0.92], [1, 1, u1, v0], [-1, 1, u0, v0], [-1, -0.84, u0, v0 + (v1 - v0) * 0.92]];
  const ids = corners.map(([x, y, u, v]) => {
    const p = add(center, add(mul(right, x), mul(up, y)));
    return b.vertex({ p, n: o.normalAt(p), u, v, ao: o.aoAt(p), sway: o.swayAt(p), kind: o.kind, phase: o.phase });
  });
  const root = b.vertex({ p: anchor, n: o.normalAt(anchor), u: (u0 + u1) / 2, v: v0 + (v1 - v0) * stemV,
    ao: o.aoAt(anchor), sway: 0, kind: o.kind, phase: o.phase });
  for (let i = 0; i < 3; i++) b.tri(root, ids[i], ids[i + 1]);
}

/** Interleaved 24-byte vertices (position f32x3, octahedral normal unorm16x2, uv unorm16x2, attr unorm8x4) for a set of meshes. */
export interface PackedMeshes {
  vertices: Uint8Array;
  indices: Uint32Array;
  ranges: { indexCount: number; firstIndex: number; baseVertex: number; vertexCount: number }[];
}

/** Octahedral encoding into [0, 1]^2, the exact inverse of octDecode in common/math.wgsl. */
export function octEncode(n: Vec3, out: [number, number]): [number, number] {
  const s = Math.abs(n[0]) + Math.abs(n[1]) + Math.abs(n[2]);
  let x = n[0] / s, y = n[1] / s;
  if (n[2] / s < 0) {
    const ox = (1 - Math.abs(y)) * (x >= 0 ? 1 : -1);
    const oy = (1 - Math.abs(x)) * (y >= 0 ? 1 : -1);
    x = ox; y = oy;
  }
  out[0] = x * 0.5 + 0.5;
  out[1] = y * 0.5 + 0.5;
  return out;
}

export function packMeshes(meshes: readonly MeshData[]): PackedMeshes {
  let vt = 0, it = 0;
  for (const m of meshes) { vt += m.vertexCount; it += m.idx.length; }
  const vertices = new Uint8Array(vt * VERTEX_STRIDE);
  const dv = new DataView(vertices.buffer);
  const indices = new Uint32Array(it);
  const ranges: PackedMeshes['ranges'] = [];
  const oct: [number, number] = [0, 0];
  const u16 = (x: number): number => Math.round(clamp01(x) * 65535);
  let vBase = 0, iBase = 0;
  for (const m of meshes) {
    for (let i = 0; i < m.vertexCount; i++) {
      const o = (vBase + i) * VERTEX_STRIDE;
      dv.setFloat32(o, m.pos[i * 3], true);
      dv.setFloat32(o + 4, m.pos[i * 3 + 1], true);
      dv.setFloat32(o + 8, m.pos[i * 3 + 2], true);
      octEncode([m.nrm[i * 3], m.nrm[i * 3 + 1], m.nrm[i * 3 + 2]], oct);
      dv.setUint16(o + 12, u16(oct[0]), true);
      dv.setUint16(o + 14, u16(oct[1]), true);
      dv.setUint16(o + 16, u16(m.uv[i * 2]), true);
      dv.setUint16(o + 18, u16(m.uv[i * 2 + 1]), true);
      for (let k = 0; k < 4; k++) vertices[o + 20 + k] = m.attr[i * 4 + k];
    }
    indices.set(m.idx, iBase);
    ranges.push({ indexCount: m.idx.length, firstIndex: iBase, baseVertex: vBase, vertexCount: m.vertexCount });
    vBase += m.vertexCount;
    iBase += m.idx.length;
  }
  return { vertices, indices, ranges };
}
`,Ax=`/** Integer-hash value noise on the CPU, used by the placement fields and the procedural mesh and texture generators. */

export function hash2(ix: number, iy: number, seed: number): number {
  let h = Math.imul(ix | 0, 0x27d4eb2d) ^ Math.imul(iy | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function hash3(ix: number, iy: number, iz: number, seed: number): number {
  let h = Math.imul(ix | 0, 0x27d4eb2d) ^ Math.imul(iy | 0, 0x165667b1) ^ Math.imul(iz | 0, 0x85ebca77) ^ Math.imul(seed | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const fade = (t: number): number => t * t * (3 - 2 * t);

export function valueNoise2(x: number, y: number, seed: number): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = fade(x - ix), fy = fade(y - iy);
  const a = hash2(ix, iy, seed), b = hash2(ix + 1, iy, seed);
  const c = hash2(ix, iy + 1, seed), d = hash2(ix + 1, iy + 1, seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

export function valueNoise3(x: number, y: number, z: number, seed: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = fade(x - ix), fy = fade(y - iy), fz = fade(z - iz);
  const v = (dx: number, dy: number, dz: number): number => hash3(ix + dx, iy + dy, iz + dz, seed);
  const x00 = v(0, 0, 0) + (v(1, 0, 0) - v(0, 0, 0)) * fx;
  const x10 = v(0, 1, 0) + (v(1, 1, 0) - v(0, 1, 0)) * fx;
  const x01 = v(0, 0, 1) + (v(1, 0, 1) - v(0, 0, 1)) * fx;
  const x11 = v(0, 1, 1) + (v(1, 1, 1) - v(0, 1, 1)) * fx;
  const y0 = x00 + (x10 - x00) * fy, y1 = x01 + (x11 - x01) * fy;
  return y0 + (y1 - y0) * fz;
}

/** Fractal value noise normalised to [0, 1] (each octave halves in amplitude and doubles in frequency). */
export function fbm2(x: number, y: number, seed: number, octaves: number): number {
  let sum = 0, amp = 0.5, norm = 0, f = 1;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise2(x * f + i * 17.3, y * f - i * 9.1, seed + i * 101);
    norm += amp;
    amp *= 0.5;
    f *= 2;
  }
  return sum / norm;
}

export function fbm3(x: number, y: number, z: number, seed: number, octaves: number): number {
  let sum = 0, amp = 0.5, norm = 0, f = 1;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise3(x * f + i * 17.3, y * f - i * 9.1, z * f + i * 5.7, seed + i * 101);
    norm += amp;
    amp *= 0.5;
    f *= 2;
  }
  return sum / norm;
}

export const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};
`,jx=`import { tierTable, type QualityProfile } from '../contracts';
import type { RenderQuality, Vec3 } from '../../contracts';

/** Side of a grass patch in metres; blades are hashed per (patch cell, slot), so this fixes the pattern for a given seed. */
export const PATCH_SIZE = 4;
/** Slots handled by one compute workgroup. */
export const CHUNK_SLOTS = 64;
export const BLADE_BYTES = 32;
export const CHUNK_BYTES = 16;
export const VEG_PARAM_BYTES = 160;
/** Blade instance buffers never exceed this, whatever the tier asks for (further clamped to the device limits). */
export const MAX_GRASS_BYTES = 192 * 1024 * 1024;
/** Share of the full-circle instance count each LOD region can hold. A wide FPV lens sees about 0.4 of the circle, but a tilted-down view
 * and the patch-level culling add to it, and an overflow drops whole patches (bare rectangles in the sward), so the margin is generous.
 * Full share rather than a 20% cut: the levels are chosen by projected pixel size, so how the blades fall between the three regions
 * moves with the canvas resolution, and the region that gains at high resolution is not known ahead of time. The cap only bounds the
 * output - candidate generation is set by the chunk work list and the distance thinning - so headroom here costs buffer size, not work,
 * and the tier budgets sit well under MAX_GRASS_BYTES. */
const CAP_FRACTION = 1.0;
const NO_QUAD = -1e9;
/** The tier tables count blades loosely; a meadow has thousands per m2 and a near blade is a handful of pixels wide, so the near field is scaled up. */
export function nearDensity(tierBladesPerM2: number): number {
  return tierBladesPerM2 * Math.min(6, Math.max(3, 7 - tierBladesPerM2 / 250));
}
/** Blades beyond a few metres are sub-pixel anyway, so full density stops here whatever the tier's view distance. */
const FULL_RADIUS_MAX = 7;
/** Grass distance whose level-of-detail bands the pixel thresholds in grass_cull.wgsl were calibrated against (grassLod.test.ts). */
const LOD_BAND_DISTANCE = 120;

export interface GrassBudget {
  patchSize: number;
  /** Patch grid is cellsPerSide x cellsPerSide, centred on the camera. */
  cellsPerSide: number;
  /** Hash slots per patch at full density (blades/m2 x patch area). */
  slotsPerPatch: number;
  /** Full density inside this radius, area density falling as 1/d^2 (constant screen-space density) beyond. */
  fullRadius: number;
  distance: number;
  lodDistance: [number, number];
  /** Instance capacity per LOD region and the chunk work-list capacity. */
  caps: [number, number, number];
  chunkCap: number;
  /** Byte offset of each LOD region in the blade buffer and its total size. */
  offsets: [number, number, number];
  bladeBytes: number;
}

function keepFraction(d: number, r0: number, far: number): number {
  const k = Math.min(1, (r0 / Math.max(d, 1e-3)) ** 2);
  const s = Math.min(1, Math.max(0, (d - 0.72 * far) / (0.28 * far)));
  return k * (1 - s * s * (3 - 2 * s));
}

/** Expected blade slots between radii \`ra\` and \`rb\` around the camera over the whole circle (midpoint rule, 96 rings). */
export function annulusSlots(ra: number, rb: number, density: number, r0: number, far: number): number {
  const n = 96, dr = (rb - ra) / n;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const r = ra + (i + 0.5) * dr;
    sum += 2 * Math.PI * r * dr * density * keepFraction(r, r0, far);
  }
  return sum;
}

const roundUp = (v: number, m: number): number => Math.ceil(v / m) * m;

/**
 * Instance and chunk capacities for a quality tier: preallocated once, never resized, clamped to \`maxBytes\`.
 * Estimated cost on a mid GPU at 1080p (not measured, the harness only has a software rasteriser): cull about 0.2 ms at high (roughly
 * 200k candidate slots, one hashed terrain-map fetch each) and 0.8 ms at ultra; draw about 1.5 ms at high (about 580k triangles from
 * 128k blades over three LODs, 32 B per blade) and about 3 ms at ultra.
 */
export function grassBudget(q: Pick<QualityProfile, 'grassBladesPerM2' | 'grassDistance'>, maxBytes: number = MAX_GRASS_BYTES): GrassBudget {
  const far = q.grassDistance;
  const fullRadius = Math.min(0.125 * far, FULL_RADIUS_MAX);
  // The cull picks a level by projected size (GRASS_LOD*_PX), tuned to the bands of a 120 m sward; a longer one adds far-level blades.
  const bandFar = Math.min(far, LOD_BAND_DISTANCE);
  const lod0 = Math.max(4, 0.09 * bandFar), lod1 = Math.max(12, 0.28 * bandFar);
  const density = nearDensity(q.grassBladesPerM2);
  const edges = [0, lod0, lod1, far];
  let caps = [0, 1, 2].map((i) => roundUp(CAP_FRACTION * annulusSlots(edges[i], edges[i + 1], density, fullRadius, far) + 4096, CHUNK_SLOTS));
  const total = caps[0] + caps[1] + caps[2];
  const limit = Math.floor(Math.min(maxBytes, MAX_GRASS_BYTES) / BLADE_BYTES / CHUNK_SLOTS) * CHUNK_SLOTS;
  if (total > limit) caps = caps.map((c) => Math.max(CHUNK_SLOTS, Math.floor((c * limit) / total / CHUNK_SLOTS) * CHUNK_SLOTS));
  const patches = Math.ceil((2 * far) / PATCH_SIZE) + 3;
  const slotsPerPatch = density * PATCH_SIZE * PATCH_SIZE;
  const c0 = caps[0], c1 = caps[1], c2 = caps[2];
  return {
    patchSize: PATCH_SIZE,
    cellsPerSide: patches,
    slotsPerPatch,
    fullRadius,
    distance: far,
    lodDistance: [lod0, lod1],
    caps: [c0, c1, c2],
    chunkCap: Math.ceil(annulusSlots(0, far, density, fullRadius, far) / CHUNK_SLOTS) + patches * patches,
    offsets: [0, c0 * BLADE_BYTES, (c0 + c1) * BLADE_BYTES],
    bladeBytes: (c0 + c1 + c2) * BLADE_BYTES,
  };
}

export interface TreeParams {
  /** Multiplies every variant's LOD hand-over distances. */
  lodScale: number;
  /** Instances further than this are culled (m). */
  maxDistance: number;
  /** Instances whose bounding sphere covers fewer pixels than this are culled. */
  minPixels: number;
  /** 1 turns on the leaf detail of the extreme tier in tree.wgsl (leaf flicker on every LOD, the stronger leaf forward scatter); 0 below it. */
  leafDetail: number;
  /** Instance slots (padding included), which is also the stride of each LOD's visible list; 0 disables the tree cull. */
  slots: number;
  draws: number;
}

/** Tree draw distance and LOD bias per quality tier (instance counts per tier are in placement.ts, TIER_LIMITS). */
export const TREE_TIER: Readonly<Record<RenderQuality, Pick<TreeParams, 'lodScale' | 'maxDistance' | 'minPixels' | 'leafDetail'>>> = tierTable({
  low: { lodScale: 0.6, maxDistance: 700, minPixels: 1.5, leafDetail: 0 },
  medium: { lodScale: 0.8, maxDistance: 1100, minPixels: 1.5, leafDetail: 0 },
  high: { lodScale: 1, maxDistance: 1600, minPixels: 1.5, leafDetail: 0 },
  // Ultra's near LOD reaches as far as high's: its crowns are 2-5 times the triangles they were (sprigs, shoots, roots), and the extra
  // quarter of range cost about 0.35 ms on the race views (track 210-t2 gate 3) for trees too far to show the difference.
  ultra: { lodScale: 1, maxDistance: 2400, minPixels: 1.5, leafDetail: 0 },
// Extreme has no budget: the near LOD builds the outer leaves one by one (treeGen.ts leafShoot), so it reaches a little further than ultra
// rather than three times as far, the dense LOD1 carries the crowns from there to 4 km, nothing is culled until it is smaller than
// half a pixel, leaf detail on, and (leafDetail = 1 also tells veg_instance.wgsl) no flat LOD2 billboards at any distance.
}, { lodScale: 1.5, maxDistance: 4000, minPixels: 0.5, leafDetail: 1 });

/** Canopy cards standing in for trees beyond the real-tree draw distance (treePlanFar.ts): the most cards a tier holds. */
export const FAR_TIER: Readonly<Record<RenderQuality, { cards: number }>> = tierTable({
  low: { cards: 14000 },
  medium: { cards: 30000 },
  high: { cards: 50000 },
  ultra: { cards: 70000 },
}, { cards: 160000 });
/** Cards for ground with no real trees show from this camera distance (m); a card in front of real trees shows from the tree draw distance. */
export const FAR_UNCOVERED_NEAR = 150;

export interface VegParamInput {
  parkRadius?: number;
  windDir: readonly [number, number];
  windSpeed: number;
  quad: { pos: Vec3; vel: Vec3; thrust: number } | null;
  budget: GrassBudget;
  /** Below this world height there is water; use -Infinity or NaN for none. */
  waterLevel: number;
  seed: number;
  cameraXZ: readonly [number, number];
  tree: TreeParams;
  /** Cards fade out towards this camera distance (m); 0 draws none. */
  farDistance: number;
}

export interface VegParamViews {
  f32: Float32Array;
  i32: Int32Array;
  u32: Uint32Array;
}

export function createParamViews(): VegParamViews {
  const buf = new ArrayBuffer(VEG_PARAM_BYTES);
  return { f32: new Float32Array(buf), i32: new Int32Array(buf), u32: new Uint32Array(buf) };
}

/** Writes the VegParams uniform (layout in shaders/vegetation/veg_params.wgsl, 10 blocks of 16 bytes). */
export function packVegParams(v: VegParamViews, p: VegParamInput): void {
  const { f32, i32, u32 } = v;
  const b = p.budget;
  const len = Math.hypot(p.windDir[0], p.windDir[1]);
  f32[0] = len > 1e-6 ? p.windDir[0] / len : 1;
  f32[1] = len > 1e-6 ? p.windDir[1] / len : 0;
  f32[2] = p.windSpeed;
  f32[3] = p.parkRadius ?? 0;
  if (p.quad) {
    f32[4] = p.quad.pos[0]; f32[5] = p.quad.pos[1]; f32[6] = p.quad.pos[2]; f32[7] = p.quad.thrust;
    f32[8] = p.quad.vel[0]; f32[9] = p.quad.vel[1]; f32[10] = p.quad.vel[2];
  } else {
    f32[4] = 0; f32[5] = NO_QUAD; f32[6] = 0; f32[7] = 0;
    f32[8] = 0; f32[9] = 0; f32[10] = 0;
  }
  f32[11] = 0;
  f32[12] = b.patchSize; f32[13] = b.distance; f32[14] = b.fullRadius; f32[15] = b.slotsPerPatch / (b.patchSize * b.patchSize);
  f32[16] = b.lodDistance[0]; f32[17] = b.lodDistance[1];
  f32[18] = Number.isFinite(p.waterLevel) ? p.waterLevel : -1e9;
  f32[19] = b.slotsPerPatch;
  const half = (b.cellsPerSide * b.patchSize) / 2;
  i32[20] = Math.floor((p.cameraXZ[0] - half) / b.patchSize);
  i32[21] = Math.floor((p.cameraXZ[1] - half) / b.patchSize);
  i32[22] = b.cellsPerSide;
  i32[23] = p.seed | 0;
  u32[24] = b.caps[0]; u32[25] = b.caps[1]; u32[26] = b.caps[2]; u32[27] = b.chunkCap;
  f32[28] = p.tree.lodScale; f32[29] = p.tree.maxDistance; f32[30] = p.tree.minPixels; f32[31] = p.tree.leafDetail;
  u32[32] = p.tree.slots; u32[33] = p.tree.draws; u32[34] = 0; u32[35] = 0;
  f32[36] = p.farDistance; f32[37] = 0; f32[38] = 0; f32[39] = 0;
}
`,Mx=`import type { Vec3 } from '../../contracts';
import { MAX_PARK_PLANTINGS } from '../../world/park/planting';
import type { ParkPlanting } from '../../world/park/types';
import type { RTPrimitive } from '../contracts';
import type { InstanceSet, VegPlacement } from './placement';
import { MAX_WOOD_CAPSULES, plantCanopyShadows, plantWoodShadows } from './plantShadows';
import { VARIANT_DEFS } from './variants';

/** Both snorm16 components are -32768, which the terrain normal encoder never emits. */
export const PARK_PLANT_NORMAL = 0x80008000;
/** Explicit planted trees remain visible to the park's own draw range on every tier. */
export const PARK_PLANT_DISTANCE = 1900;

export function packPlantTint(tint: Vec3): number {
  const c = tint.map(v => Math.round(Math.max(0, Math.min(2, v)) * 127.5));
  return (c[0] | c[1] << 8 | c[2] << 16 | 128 << 24) >>> 0;
}

/** Stable explicit-plant prefix; natural forest ordering and source arrays are untouched. */
export function prependParkPlantings(forest: VegPlacement, requested: readonly ParkPlanting[] = []): { placement: VegPlacement; count: number } {
  const count = Math.min(requested.length, MAX_PARK_PLANTINGS);
  if (count === 0) return { placement: forest, count: 0 };
  const source = forest.plants, total = source.count + count;
  const plants: InstanceSet = { count: total, pos: new Float32Array(total * 3), scale: new Float32Array(total), yaw: new Float32Array(total),
    variant: new Uint8Array(total), tint: new Uint32Array(total), nrm: new Uint32Array(total), pathDist: new Float32Array(total) };
  plants.pos.set(source.pos.subarray(0, source.count * 3), count * 3);
  for (const key of ['scale', 'yaw', 'variant', 'tint', 'nrm', 'pathDist'] as const) plants[key].set(source[key].subarray(0, source.count), count);
  let trees = forest.trees, bushes = forest.bushes;
  for (let i = 0; i < count; i++) {
    const plant = requested[i];
    plants.pos.set(plant.pos, i * 3); plants.scale[i] = plant.scale; plants.yaw[i] = plant.yaw; plants.variant[i] = plant.variant;
    plants.tint[i] = packPlantTint(plant.tint); plants.nrm[i] = PARK_PLANT_NORMAL; plants.pathDist[i] = Infinity;
    if (VARIANT_DEFS[plant.variant].group === 'tree') trees++; else bushes++;
  }
  const plantRing = new Float32Array(total); plantRing.set(forest.plantRing.subarray(0, source.count), count);
  return { placement: { ...forest, plants, trees, bushes, plantRing, obstacleTrees: forest.obstacleTrees + count }, count };
}

export function tierPlantCount(placement: VegPlacement, naturalLimit: number, parkCount: number): number {
  return Math.min(placement.plants.count, naturalLimit + parkCount);
}

/** Soft Beer–Lambert canopy proxies: one to three spheres per planting, fitted to the leaves that are drawn, placed with the planting's yaw and scale. */
export function parkCanopyProxies(plantings: readonly ParkPlanting[] = []): RTPrimitive[] {
  return plantings.slice(0, MAX_PARK_PLANTINGS).flatMap(plant => plantCanopyShadows(plant.variant, plant));
}

export const MAX_PARK_WOOD_SHADOWS = MAX_WOOD_CAPSULES;

/** A bounded shadow skeleton: chords that stay within half a radius of the drawn trunk and thick limbs. The raster wood and the 24-segment physical skeleton stay intact. */
export function parkWoodProxies(plantings: readonly ParkPlanting[] = []): RTPrimitive[] {
  return plantings.slice(0, MAX_PARK_PLANTINGS).flatMap(plant => plantWoodShadows(plant.variant, plant));
}
`,Nx=`import type { RenderQuality, TerrainData, TrackData } from '../../contracts';
import { obstacleKeepOuts, tunnelKeepOuts } from '../../world/track/kindGeometry';
import { PathIndex } from '../../world/track/pathIndex';
import { deriveSeed } from '../../world/track/rng';
import { TREE_COLLIDER_RANGE } from './colliders';
import { hash2, smoothstep } from './noise';
import { MAX_TREE_SCALE, MIN_TREE_SCALE, PlacementRules, type Pick } from './placementRules';
import { COARSE, buildRegion, type Region } from './region';
import { rockAssets } from './rockGen';
import { KIND } from './meshBuilder';
import { SpatialHash } from './spatialHash';
import { TerrainFields } from './terrainFields';
import { VARIANT_DEFS, VARIANTS_OF, layoutCrown, variantPlan } from './variants';

export interface PlacementLimits {
  /** Trees and bushes together. */
  plants: number;
  rocks: number;
}

const ULTRA_LIMITS: PlacementLimits = { plants: 40000, rocks: 4000 };

/**
 * Instance budgets per quality tier; the smaller tiers are prefixes of the larger ones (the walk is nearest-track first). Extreme always
 * equals ultra: placement and colliders are built from the ultra limits, and trained brains and saved tracks depend on them.
 */
export const TIER_LIMITS: Readonly<Record<RenderQuality, PlacementLimits>> = {
  low: { plants: 16000, rocks: 2000 },
  medium: { plants: 22000, rocks: 2600 },
  high: { plants: 30000, rocks: 3200 },
  ultra: ULTRA_LIMITS,
  extreme: ULTRA_LIMITS,
};

/** Struct-of-arrays instance list; \`variant\` indexes VARIANT_DEFS. */
export interface InstanceSet {
  count: number;
  pos: Float32Array;
  scale: Float32Array;
  yaw: Float32Array;
  variant: Uint8Array;
  /** Packed unorm8x4 colour multiplier (decoded as value * 2). */
  tint: Uint32Array;
  /** Terrain normal x and z as two packed snorm16. */
  nrm: Uint32Array;
  /** Horizontal distance to the racing line in metres; Infinity when farther than about 115 m or without a track. */
  pathDist: Float32Array;
}

export interface VegPlacement {
  plants: InstanceSet;
  rocks: InstanceSet;
  trees: number;
  bushes: number;
  /** The first \`obstacleTrees\` plants are the track's tree obstacles (real trees on the obstacle's spot, whatever the ground); the rest follow the density rules. */
  obstacleTrees: number;
  /** Per plant, the approximate distance (m) from the racing line to the walk cell that produced it (0 for obstacle trees); a tier's prefix is complete out to roughly its last entry. */
  plantRing: Float32Array;
}

export const REGION_RADIUS = 1000;
/** Seed of the density rules and of the walk order; the far-field canopy uses the same ones so its stands line up with the real trees. */
export const placementSeed = (terrain: TerrainData): number => deriveSeed(terrain.seed, 0x7e6e);
export const regionSeed = (terrain: TerrainData): number => deriveSeed(terrain.seed, 0x7e6e, 23) | 0;
/** Rocks are always placed up to this many so that plants avoid the same ground in every tier. */
export const ROCK_CAP = 4000;
/** Trees and bushes stay this far from the racing line; the brief asks for at least 6 m. */
export const PATH_CLEARANCE = 6.5;
const ROCK_PATH_CLEARANCE = 3.5;
/** Cells whose approximate distance exceeds this cannot hold ground within CORRIDOR_WIDTH of the path (the cell grid is off by at most 34 m plus 8%). */
const NEAR_PATH = 115;
const PLANT_CELL = 3;
const ROCK_CELL = 4;
const PLANT_PER_COARSE = COARSE / PLANT_CELL;
const ROCK_PER_COARSE = COARSE / ROCK_CELL;
/** Fraction of candidates kept right at the racing line, rising to 1 at CORRIDOR_WIDTH. */
const CORRIDOR_DENSITY = 0.55;
/** Share of trees beyond the collider range that stand dead, on top of the snags of closed stands (placementRules.ts): 5 to 8 % in all. */
const EXTRA_SNAGS = 0.05;
const CORRIDOR_WIDTH = 70;
const TREE_TRUNK = 0.3;
/** Unit colour multiplier (decoded as value * 2). */
const NEUTRAL_TINT = 0x80808080;
const BUSH_TRUNK = 0.5;

function makeSet(cap: number): InstanceSet {
  return { count: 0, pos: new Float32Array(cap * 3), scale: new Float32Array(cap), yaw: new Float32Array(cap), variant: new Uint8Array(cap), tint: new Uint32Array(cap), nrm: new Uint32Array(cap), pathDist: new Float32Array(cap) };
}

/** The first n instances (copied), so the arrays hold exactly what is used. */
function take(s: InstanceSet, n: number): InstanceSet {
  return { count: n, pos: s.pos.slice(0, n * 3), scale: s.scale.slice(0, n), yaw: s.yaw.slice(0, n), variant: s.variant.slice(0, n), tint: s.tint.slice(0, n), nrm: s.nrm.slice(0, n), pathDist: s.pathDist.slice(0, n) };
}

const snorm16 = (v: number): number => Math.round(Math.min(Math.max(v, -1), 1) * 32767) & 0xffff;

/** Terrain normal xz from the gradient left in \`fields\` by the rule that just accepted the candidate. */
function packNormal(gx: number, gz: number): number {
  const inv = 1 / Math.hypot(gx, gz, 1);
  return (snorm16(-gx * inv) | (snorm16(-gz * inv) << 16)) >>> 0;
}

function push(s: InstanceSet, x: number, y: number, z: number, p: Pick, nrm: number, pathDist: number): void {
  const i = s.count++;
  s.pos[i * 3] = x; s.pos[i * 3 + 1] = y; s.pos[i * 3 + 2] = z;
  s.scale[i] = p.scale; s.yaw[i] = p.yaw; s.variant[i] = p.variant; s.tint[i] = p.tint; s.nrm[i] = nrm; s.pathDist[i] = pathDist;
}

/** Ground that stays free of plants and rocks: gate openings and tunnel sleeves, obstacles and the launch pad. */
function buildBlockers(track: TrackData | null, x0: number, z0: number, x1: number, z1: number): SpatialHash {
  const h = new SpatialHash(x0, z0, x1, z1, 32, 64);
  if (!track) return h;
  // Keep the graded park interior and every attraction envelope free of unrelated terrain scatter.
  for (const g of track.gates) {
    h.add(g.pos[0], g.pos[2], 0.5 * Math.hypot(g.width, g.height) + 2, 0);
    if (g.kind === 'tunnel') for (const d of tunnelKeepOuts(g)) h.add(d.x, d.z, d.r, 0);
  }
  // Long structures (bridges, scaffolds, beams) get several discs along their length (kindGeometry.ts obstacleKeepOuts).
  for (const o of track.obstacles) for (const d of obstacleKeepOuts(o)) h.add(d.x, d.z, d.r, 0);
  h.add(track.start.pos[0], track.start.pos[2], 8, 0);
  return h;
}

interface Tables {
  /** Horizontal crown radius (m at scale 1) per plant variant, so trees keep their branches out of gates (the settled layout's, layoutCrown). */
  crown: number[];
  /** Height in metres of each rock mesh at scale 1. */
  rockHeight: number[];
  /** Trunk radius and crown-top height (m at scale 1) of each plant variant. */
  trunk: number[];
  top: number[];
}

let tables: Tables | null = null;

function lookup(): Tables {
  tables ??= {
    crown: VARIANT_DEFS.map((_, v) => layoutCrown(v)?.crown ?? 0),
    rockHeight: VARIANT_DEFS.map((d) => (d.rock >= 0 ? rockAssets()[d.rock].height : 0)),
    trunk: VARIANT_DEFS.map((_, v) => layoutCrown(v)?.trunk ?? 0),
    top: VARIANT_DEFS.map((_, v) => layoutCrown(v)?.top ?? 0),
  };
  return tables;
}

class Placer {
  readonly fields: TerrainFields;
  readonly rules: PlacementRules;
  readonly blockers: SpatialHash;
  readonly rockHash: SpatialHash;
  readonly plantHash: SpatialHash;
  private readonly index: PathIndex | null;
  private readonly pick: Pick = { variant: 0, scale: 1, yaw: 0, tint: 0 };
  private readonly tables = lookup();
  private readonly sJit: number;
  private readonly sPerm: number;
  obstacleTrees = 0;
  ring = new Float32Array(0);

  constructor(readonly terrain: TerrainData, private readonly track: TrackData | null, readonly region: Region) {
    const seed = placementSeed(terrain);
    this.fields = new TerrainFields(terrain);
    this.rules = new PlacementRules(this.fields, seed);
    this.sJit = deriveSeed(seed, 21) | 0;
    this.sPerm = deriveSeed(seed, 22) | 0;
    const e = (terrain.resolution - 1) * terrain.cellSize;
    const [ox, oz] = terrain.origin;
    this.blockers = buildBlockers(track, ox, oz, ox + e, oz + e);
    this.rockHash = new SpatialHash(ox, oz, ox + e, oz + e, 6, 4096);
    this.plantHash = new SpatialHash(ox, oz, ox + e, oz + e, 9, 8192);
    this.index = track && track.path.length > 0 ? new PathIndex(track.path) : null;
  }

  /** Exact horizontal distance to the racing line when the cell is near it, otherwise Infinity. */
  private pathDistance(x: number, z: number, cellDist: number): number {
    if (!this.index || cellDist > NEAR_PATH) return Infinity;
    this.index.nearestXZ(x, z);
    return this.index.lastDist;
  }

  /** Height of the lowest of five samples under a rock, less the buried fraction of its height. */
  private rockBase(x: number, z: number, radius: number, sink: number, height: number): number {
    const f = this.fields, e = radius * 0.7;
    const low = Math.min(f.height(x, z), f.height(x + e, z), f.height(x - e, z), f.height(x, z + e), f.height(x, z - e));
    return low - sink * height * radius;
  }

  placeRocks(cap: number): InstanceSet {
    const out = makeSet(cap), r = this.region, pick = this.pick, f = this.fields;
    for (const c of r.order) {
      if (out.count >= cap) break;
      const ci = r.i0 + (c % r.nx), cj = r.j0 + Math.floor(c / r.nx), cellDist = r.dist[c];
      const n2 = ROCK_PER_COARSE * ROCK_PER_COARSE, off = Math.floor(hash2(ci, cj, this.sPerm + 1) * n2);
      for (let s = 0; s < n2 && out.count < cap; s++) {
        const k = (s * 7 + off) % n2;
        const cx = ci * ROCK_PER_COARSE + (k % ROCK_PER_COARSE), cz = cj * ROCK_PER_COARSE + Math.floor(k / ROCK_PER_COARSE);
        const x = (cx + 0.1 + 0.8 * hash2(cx, cz, this.sJit + 1)) * ROCK_CELL, z = (cz + 0.1 + 0.8 * hash2(cx, cz, this.sJit + 2)) * ROCK_CELL;
        if (!f.inside(x, z, 6) || !this.rules.rock(cx, cz, x, z, pick)) continue;
        const rad = pick.scale;
        if (this.track?.parkMap && Math.hypot(x, z) < this.track.parkMap.radius + rad) continue;
        const d = this.pathDistance(x, z, cellDist);
        if (d < ROCK_PATH_CLEARANCE + rad) continue;
        if (this.blockers.overlaps(x, z, rad, 0.5) || this.rockHash.conflicts(x, z, rad, 0, 1.3, 1.3)) continue;
        const nrm = packNormal(f.gx, f.gz);
        const sink = 0.15 + 0.25 * hash2(cx, cz, this.sJit + 3);
        push(out, x, this.rockBase(x, z, rad, sink, this.tables.rockHeight[pick.variant]), z, pick, nrm, d);
        this.rockHash.add(x, z, rad, 0);
      }
    }
    return take(out, out.count);
  }

  /**
   * The track's tree obstacles become real trees: the species and scale whose trunk and height best match the obstacle's collision
   * cylinder (radius \`size[0]\`, height \`size[1]\`), leaning on the local conifer share. Placed first so every quality tier keeps them.
   */
  private placeObstacleTrees(out: InstanceSet): void {
    const f = this.fields, t = this.tables;
    const trees = [...VARIANTS_OF.spruce, ...VARIANTS_OF.pine, ...VARIANTS_OF.oak, ...VARIANTS_OF.birch];
    this.track?.obstacles.forEach((o, index) => {
      if (o.kind !== 'tree') return;
      const [x, , z] = o.pos, r = o.size[0], h = o.size[1];
      const hRel = (f.height(x, z) - f.data.minHeight) / Math.max(f.data.maxHeight - f.data.minHeight, 1);
      const share = this.rules.conifer(x, z, hRel, f.wetness(x, z));
      let best = trees[0], bestScore = Infinity, bestScale = 1;
      for (const v of trees) {
        const sr = r / t.trunk[v], sh = h / t.top[v];
        const conifer = variantPlan(v)?.foliage === KIND.needle ? 1 : 0;
        const score = Math.abs(Math.log(sr / sh)) + 0.8 * Math.abs(conifer - share) + 0.3 * hash2(index, v, this.sJit);
        if (score < bestScore) { bestScore = score; best = v; bestScale = Math.sqrt(sr * sh); }
      }
      const scale = Math.min(Math.max(bestScale, MIN_TREE_SCALE), MAX_TREE_SCALE * 1.15);
      f.gradient(x, z);
      push(out, x, f.height(x, z) - 0.05 * scale, z, { variant: best, scale, yaw: o.yaw, tint: NEUTRAL_TINT }, packNormal(f.gx, f.gz), this.pathDistance(x, z, 0));
      this.plantHash.add(x, z, VARIANT_DEFS[best].spacing * scale, 0);
      this.obstacleTrees++;
    });
  }

  placePlants(cap: number): InstanceSet {
    const out = makeSet(cap), r = this.region, pick = this.pick, f = this.fields;
    const n2 = PLANT_PER_COARSE * PLANT_PER_COARSE;
    const ring = new Float32Array(cap);
    this.placeObstacleTrees(out);
    for (const c of r.order) {
      if (out.count >= cap) break;
      const ci = r.i0 + (c % r.nx), cj = r.j0 + Math.floor(c / r.nx), cellDist = r.dist[c];
      const off = Math.floor(hash2(ci, cj, this.sPerm) * n2);
      for (let s = 0; s < n2 && out.count < cap; s++) {
        const k = (s * 37 + off) % n2;
        const cx = ci * PLANT_PER_COARSE + (k % PLANT_PER_COARSE), cz = cj * PLANT_PER_COARSE + Math.floor(k / PLANT_PER_COARSE);
        const x = (cx + 0.1 + 0.8 * hash2(cx, cz, this.sJit)) * PLANT_CELL, z = (cz + 0.1 + 0.8 * hash2(cx, cz, this.sJit + 7)) * PLANT_CELL;
        if (!f.inside(x, z, 6)) continue;
        if (this.track?.parkMap && Math.hypot(x, z) < this.track.parkMap.radius + 10) continue;
        const kind = this.rules.plant(cx, cz, x, z, pick);
        if (kind === 0) continue;
        const d = this.pathDistance(x, z, cellDist);
        if (d < PATH_CLEARANCE) continue;
        if (d < CORRIDOR_WIDTH && hash2(cx, cz, this.sJit + 9) >= CORRIDOR_DENSITY + (1 - CORRIDOR_DENSITY) * smoothstep(PATH_CLEARANCE, CORRIDOR_WIDTH, d)) continue;
        const scale = pick.scale, def = VARIANT_DEFS[pick.variant], group = kind - 1;
        if (this.blockers.overlaps(x, z, 0.8 * this.tables.crown[pick.variant] * scale, 1)) continue;
        if (this.rockHash.overlaps(x, z, group === 0 ? TREE_TRUNK : BUSH_TRUNK, 0.3)) continue;
        if (this.plantHash.conflicts(x, z, def.spacing * scale, group, 1, 0.6)) continue;
        const nrm = packNormal(f.gx, f.gz);
        ring[out.count] = cellDist;
        // Away from the race line, where trees have no collider, the canopy gets its storeys (a suppressed tree a storey down, a conifer rising
        // as a spire: placementRules.ts canopyLayer), and more trees have died and stand as snags, as in an unmanaged forest. Each tree keeps
        // the spot and spacing of the tree it would have been, so nothing else moves and no collider changes; a snag that needs more room than
        // the live tree had (a dead birch would) is left alive.
        if (group === 0 && d > TREE_COLLIDER_RANGE + 5) {
          pick.scale = Math.min(Math.max(scale * (pick.layer ?? 1), MIN_TREE_SCALE), MAX_TREE_SCALE);
          if (!(VARIANTS_OF.snag as readonly number[]).includes(pick.variant) && hash2(cx, cz, this.sJit + 11) < EXTRA_SNAGS) {
            const snag = VARIANTS_OF.snag[variantPlan(pick.variant)?.foliage === KIND.needle ? 0 : 1];
            if (VARIANT_DEFS[snag].spacing <= def.spacing) { pick.variant = snag; pick.scale = scale; }
          }
        }
        push(out, x, f.height(x, z) - 0.05 * pick.scale, z, pick, nrm, d);
        this.plantHash.add(x, z, def.spacing * scale, group);
      }
    }
    this.ring = ring.slice(0, out.count);
    return take(out, out.count);
  }
}

/**
 * Deterministic tree, bush and rock placement for a terrain and track: jittered-grid Poisson-disc sampling gated by the
 * density rules, walked from the racing line outwards so \`limits\` keeps the nearest ground and smaller tiers are prefixes.
 */
export function placeVegetation(terrain: TerrainData, track: TrackData | null, limits: PlacementLimits): VegPlacement {
  // The last few placements, by the content of what they were placed on: a vegetation module set up again on the same world (a tier
  // switch, a render-server module swap) gets the same result back instead of placing again. Callers only read it.
  const key = placementKey(terrain, track, limits);
  const hit = recent.find((r) => r.key === key);
  if (hit) return hit.place;
  const place = placeFresh(terrain, track, limits);
  recent.unshift({ key, place });
  recent.length = Math.min(recent.length, 3);
  return place;
}

const recent: { key: string; place: VegPlacement }[] = [];

/**
 * Everything placement reads, as a key: every typed array in the terrain (heights, maps) by an FNV-1a hash of its bytes, the rest of the
 * terrain, the track and the limits as JSON.
 */
function placementKey(terrain: TerrainData, track: TrackData | null, limits: PlacementLimits): string {
  const arrays: string[] = [];
  const hashArray = (v: ArrayBufferView): string => {
    const bytes = new Uint8Array(v.buffer, v.byteOffset, v.byteLength), words = new Uint32Array(v.buffer, v.byteOffset, v.byteLength >> 2);
    let a = 0x811c9dc5, b = 0x9747b28c;
    for (let i = 0; i < words.length; i++) { a = Math.imul(a ^ words[i], 0x01000193) >>> 0; b = Math.imul(b ^ words[i], 0x01000197) >>> 0; }
    for (let i = words.length * 4; i < bytes.length; i++) a = Math.imul(a ^ bytes[i], 0x01000193) >>> 0;
    return \`\${v.constructor.name}:\${v.byteLength}:\${a}:\${b}\`;
  };
  const rest = JSON.stringify(terrain, (_, v) => {
    if (ArrayBuffer.isView(v)) { arrays.push(hashArray(v)); return \`#\${arrays.length - 1}\`; }
    return v;
  });
  return \`\${rest}|\${arrays.join(',')}|\${JSON.stringify([limits, track], (_, v) => (ArrayBuffer.isView(v) ? hashArray(v) : v))}\`;
}

function placeFresh(terrain: TerrainData, track: TrackData | null, limits: PlacementLimits): VegPlacement {
  const e = (terrain.resolution - 1) * terrain.cellSize;
  const [ox, oz] = terrain.origin;
  const region = buildRegion(track, [ox + e / 2, oz + e / 2], REGION_RADIUS, [ox, oz, ox + e, oz + e], regionSeed(terrain));
  const placer = new Placer(terrain, track, region);
  const rocks = placer.placeRocks(ROCK_CAP);
  const plants = placer.placePlants(limits.plants);
  const shown = limits.rocks < rocks.count ? take(rocks, limits.rocks) : rocks;
  let trees = 0;
  for (let i = 0; i < plants.count; i++) if (VARIANT_DEFS[plants.variant[i]].group === 'tree') trees++;
  return { plants, rocks: shown, trees, bushes: plants.count - trees, obstacleTrees: placer.obstacleTrees, plantRing: placer.ring };
}
`,Px=`import type { QualityProfile } from '../contracts';
import { FAR_TIER } from './params';
import { TIER_LIMITS } from './placement';

/**
 * Everything the vegetation module sizes GPU buffers by. Compared every frame against the quality profile in force, so a live change of
 * the grass density or distance (the Performance 240 preset keeps the tier but cuts both) rebuilds what depends on it, not only a tier change.
 */
export interface VegPlan {
  grassBladesPerM2: number;
  grassDistance: number;
  /** Instance caps of the real trees and bushes and of the rocks. */
  plants: number;
  rocks: number;
  /** Canopy cards standing in for trees beyond the real-tree draw distance, and the distance they are placed and drawn to (m). */
  farCards: number;
  farDistance: number;
}

export interface VegRebuild {
  grass: boolean;
  trees: boolean;
  far: boolean;
}

export function vegPlan(q: Pick<QualityProfile, 'tier' | 'grassBladesPerM2' | 'grassDistance' | 'terrainViewDistance'>): VegPlan {
  const limits = TIER_LIMITS[q.tier];
  return {
    grassBladesPerM2: q.grassBladesPerM2,
    grassDistance: q.grassDistance,
    plants: limits.plants,
    rocks: limits.rocks,
    farCards: FAR_TIER[q.tier].cards,
    farDistance: q.terrainViewDistance,
  };
}

/**
 * What must be rebuilt to go from plan \`a\` (null: nothing built yet) to \`b\`. The far cards depend on the tree cap too: which ground the
 * real trees leave bare is the ground they stand in for.
 */
export function diffPlans(a: VegPlan | null, b: VegPlan): VegRebuild {
  if (!a) return { grass: true, trees: true, far: true };
  const trees = a.plants !== b.plants || a.rocks !== b.rocks;
  return {
    grass: a.grassBladesPerM2 !== b.grassBladesPerM2 || a.grassDistance !== b.grassDistance,
    trees,
    far: a.plants !== b.plants || a.farCards !== b.farCards || a.farDistance !== b.farDistance,
  };
}
`,Fx=`import { deriveSeed } from '../../world/track/rng';
import { fbm2, hash2, smoothstep, valueNoise2 } from './noise';
import type { TerrainFields } from './terrainFields';
import { KIND } from './meshBuilder';
import { VARIANTS_OF, variantPlan } from './variants';

export const MAX_SLOPE_DEG = 30;
const MAX_TAN = Math.tan((MAX_SLOPE_DEG * Math.PI) / 180);
export const MIN_SOIL = 0.3;
/** Tree and bush spawn density at full wetness is this much above the dry value. */
const WET_BONUS = 1.45;
/** Rivers are drawn where the flow map is above this; nothing grows in them. */
const RIVER_FLOW = 0.85;
export const MIN_TREE_SCALE = 0.32;
export const MAX_TREE_SCALE = 1.5;
/**
 * Most a conifer away from the race line outgrows its placed size, rising as a spire above the broadleaf roof (canopyLayer). It keeps the
 * room of its placed size, so it may stand closer to a neighbour than its drawn scale's spacing.
 */
export const EMERGENT_MAX = 1.3;
/** Share of a species' trees that take its character form (old drooping spruce, crooked pine, veteran oak, weeping birch). */
const CHARACTER_SHARE = 0.16;

export interface Pick {
  variant: number;
  /** Uniform scale for plants; radius in metres for rocks (the rock meshes have a 1 m radius). */
  scale: number;
  yaw: number;
  /** Packed unorm8x4 colour multiplier (decoded as value * 2). */
  tint: number;
  /**
   * A tree's scale factor for its storey in the canopy (canopyLayer), kept out of \`scale\` so spacing, the spots trees take and their
   * colliders do not depend on it; placement applies it only where trees have no collider.
   */
  layer?: number;
}

const pack = (r: number, g: number, b: number, a: number): number => {
  const q = (v: number): number => Math.round(Math.min(Math.max(v * 0.5, 0), 1) * 255);
  return (q(r) | (q(g) << 8) | (q(b) << 16) | (q(a) << 24)) >>> 0;
};

/** One far-field canopy sample: expected trees per 3 m placement cell, the species and size of a typical tree there. */
export interface Canopy {
  density: number;
  variant: number;
  scale: number;
  tint: number;
}

/** Crowns spread toward their neighbours at most this much wider than the variant's own (tree.wgsl crownSpread). */
export const MAX_CROWN_SPREAD = 1.6;

/**
 * A broadleaf in a closed stand grows its crown out until it meets its neighbours' and they interlock into one roof; one standing in the
 * open keeps its own. The spread (1 to MAX_CROWN_SPREAD) comes from the stand's tree density \`dTree\` (trees per 3 m cell, so trees stand about
 * 3 / sqrt(dTree) m apart) against the variant's crown radius, and goes into the tint's alpha byte (decoded as value * 2, like the colour);
 * the tree shader widens the crown above the trunk by it. A function of the spot alone, so a smaller tier stays a prefix of a larger one.
 */
function withCrownSpread(tint: number, variant: number, scale: number, dTree: number): number {
  const plan = variantPlan(variant);
  if (!plan || plan.foliage !== KIND.leaf || plan.clusters.length === 0) return tint;
  const spacing = 3 / Math.sqrt(Math.max(dTree, 0.02)), own = Math.max(plan.crownR[0], plan.crownR[2]) * scale;
  const spread = Math.min(Math.max((0.6 * spacing) / Math.max(own, 0.1), 1), MAX_CROWN_SPREAD);
  return ((tint & 0x00ffffff) | (Math.round(spread * 127.5) << 24)) >>> 0;
}

/** Scene-independent density fields and species rules for trees, bushes and rocks; every draw is a hash of the cell, so results do not depend on visit order. */
export class PlacementRules {
  private readonly sStand: number;
  private readonly sLine: number;
  private readonly sBush: number;
  private readonly sConifer: number;
  private readonly sClump: number;
  private readonly sDraw: number;
  private readonly sAge: number;
  private readonly sGlade: number;
  private readonly sBeech: number;
  private readonly lo: number;
  private readonly range: number;
  private readonly water: number;

  constructor(private readonly f: TerrainFields, seed: number) {
    const s = (k: number): number => deriveSeed(seed, k) | 0;
    this.sStand = s(1); this.sLine = s(2); this.sBush = s(3); this.sConifer = s(4); this.sClump = s(5); this.sDraw = s(6); this.sAge = s(7); this.sGlade = s(8); this.sBeech = s(9);
    this.lo = f.data.minHeight;
    this.range = Math.max(f.data.maxHeight - f.data.minHeight, 1);
    this.water = f.data.waterLevel;
  }

  private draw(cx: number, cz: number, k: number): number {
    return hash2(cx, cz, this.sDraw + k * 7919);
  }

  /** Share of conifers among the trees: rises with altitude (\`hRel\` in 0..1 of the height range) and falls on wet ground. */
  conifer(x: number, z: number, hRel: number, wet: number): number {
    return smoothstep(0, 0.4, hRel + 0.5 * (fbm2(x / 260, z / 260, this.sConifer, 2) - 0.5)) * (1 - 0.35 * wet);
  }

  /** Tree or bush candidate of fine cell (cx, cz) at (x, z). Fills \`out\` and returns 1 for a tree, 2 for a bush, 0 for none. */
  plant(cx: number, cz: number, x: number, z: number, out: Pick): number {
    const f = this.f;
    const stand = smoothstep(0.42, 0.57, fbm2(x / 380, z / 380, this.sStand, 3));
    const glade = smoothstep(0.62, 0.76, fbm2(x / 85, z / 85, this.sGlade, 2));
    const treeMax = (0.03 + 0.97 * stand) * (1 - 0.88 * glade);
    const bushNoise = smoothstep(0.35, 0.65, fbm2(x / 70, z / 70, this.sBush, 2));
    const bushMax = 0.3 * (0.3 + 0.7 * bushNoise) * (0.4 + 0.6 * stand) * (1 + 0.8 * glade);
    const u = this.draw(cx, cz, 0);
    if (u >= Math.min(0.85, treeMax * WET_BONUS) + bushMax) return 0;

    const soil = f.soil(x, z);
    if (soil <= MIN_SOIL) return 0;
    const tan = f.gradient(x, z);
    if (tan >= MAX_TAN) return 0;
    const h = f.height(x, z);
    if (h < this.water + 0.8) return 0;
    const flow = f.flow(x, z);
    if (flow >= RIVER_FLOW) return 0;
    const hRel = (h - this.lo) / this.range;
    const line = 0.66 + 0.2 * (valueNoise2(x / 140, z / 140, this.sLine) - 0.5);
    if (hRel >= line) return 0;

    const wet = f.wetness(x, z);
    const wetF = 0.55 + 0.9 * wet;
    const base = smoothstep(0.3, 0.55, soil) * (1 - smoothstep(0.3, MAX_TAN, tan)) * (1 - smoothstep(line - 0.14, line, hRel)) * (1 - smoothstep(0.6, RIVER_FLOW, flow));
    const dTree = Math.min(0.85, treeMax * wetF) * base;
    const dBush = bushMax * wetF * base;
    const r2 = this.draw(cx, cz, 1), r3 = this.draw(cx, cz, 2), r4 = this.draw(cx, cz, 3), r5 = this.draw(cx, cz, 4);
    const conifer = this.conifer(x, z, hRel, wet);
    out.yaw = this.draw(cx, cz, 5) * Math.PI * 2;
    const b = 0.85 + 0.3 * r5, hue = (this.draw(cx, cz, 6) - 0.5) * 0.16;
    if (u < dTree) {
      const old = this.draw(cx, cz, 7) < 0.03;
      out.variant = this.species(x, z, r2 < conifer, r3, soil, wet, smoothstep(0.12, 0.55, dTree), old);
      // A few trees in closed stands have died and stand as snags.
      if (this.draw(cx, cz, 8) < 0.006 + 0.02 * smoothstep(0.2, 0.6, dTree)) out.variant = VARIANTS_OF.snag[r2 < conifer ? 0 : 1];
      out.tint = this.crownTint(cx, cz, x, z, r2 < conifer, b, hue);
      // Stands have an age: young ones are all saplings and poles, old ones mostly big trees; every stand mixes sizes and has the odd veteran.
      const age = smoothstep(0.35, 0.65, fbm2(x / 170, z / 170, this.sAge, 2));
      const veteran = old ? 1.25 : 1;
      // A snag stands at the size it died at.
      out.layer = (VARIANTS_OF.snag as readonly number[]).includes(out.variant) ? 1 : this.canopyLayer(cx, cz, r2 < conifer, smoothstep(0.12, 0.55, dTree));
      out.scale = Math.min(Math.max((0.62 + 0.5 * age) * (0.6 + 0.8 * Math.pow(r4, 0.8)) * veteran * (1 - 0.3 * smoothstep(line - 0.25, line, hRel)), MIN_TREE_SCALE), MAX_TREE_SCALE);
      out.tint = withCrownSpread(out.tint, out.variant, out.scale, dTree);
      return 1;
    }
    if (u < dTree + dBush) {
      out.variant = r3 < 0.2 + 0.5 * conifer ? VARIANTS_OF.juniper[0] : VARIANTS_OF.bush[0];
      out.scale = 0.6 + r4;
      out.layer = 1;
      out.tint = pack(b * (1 + hue), b, b * (1 - hue), 1);
      return 2;
    }
    return 0;
  }

  /**
   * Species and growth form of a tree from the draw \`r3\`: pine on poor dry soil and spruce elsewhere among conifers; birch on wet ground, beech
   * in its own stands on deep drained soil and oak elsewhere among broadleaves. In a closed stand (\`closure\` near 1) trees are mostly
   * forest-grown, in the open mostly open-grown; a share of them, and every \`old\` one, takes the species' character form.
   */
  private species(x: number, z: number, conifer: boolean, r3: number, soil: number, wet: number, closure: number, old: boolean): number {
    let list: readonly number[], u: number;
    if (conifer) {
      const pine = 0.15 + 0.7 * (1 - smoothstep(0.3, 0.7, soil)) * (1 - wet);
      list = r3 < pine ? VARIANTS_OF.pine : VARIANTS_OF.spruce;
      u = r3 < pine ? r3 / pine : (r3 - pine) / (1 - pine);
    } else {
      const birch = 0.08 + 0.4 * wet;
      const beech = (1 - birch) * 0.55 * smoothstep(0.48, 0.6, fbm2(x / 300, z / 300, this.sBeech, 2)) * (1 - wet) * smoothstep(0.35, 0.6, soil);
      list = r3 < birch ? VARIANTS_OF.birch : r3 < birch + beech ? VARIANTS_OF.beech : VARIANTS_OF.oak;
      u = r3 < birch ? r3 / birch : r3 < birch + beech ? (r3 - birch) / beech : (r3 - birch - beech) / (1 - birch - beech);
    }
    if (list.length > 2 && (old || u < CHARACTER_SHARE)) return list[2];
    const v = list.length > 2 ? (u - CHARACTER_SHARE) / (1 - CHARACTER_SHARE) : u;
    return v < closure ? list[1] : list[0];
  }

  /**
   * The expected tree density at (x, z) by the same stand, ground and altitude rules as \`plant\`, without the per-cell draw, so far hills
   * can be dressed with canopy where the fields say forest. (cx, cz) keys the species draws; \`out.density\` is the tree probability of one 3 m cell.
   */
  canopy(cx: number, cz: number, x: number, z: number, out: Canopy): void {
    const f = this.f;
    out.density = 0;
    const stand = smoothstep(0.42, 0.57, fbm2(x / 380, z / 380, this.sStand, 3));
    const glade = smoothstep(0.62, 0.76, fbm2(x / 85, z / 85, this.sGlade, 2));
    const treeMax = (0.03 + 0.97 * stand) * (1 - 0.88 * glade);
    const soil = f.soil(x, z);
    if (soil <= MIN_SOIL || treeMax < 0.01) return;
    const tan = f.gradient(x, z);
    const h = f.height(x, z);
    const flow = f.flow(x, z);
    if (tan >= MAX_TAN || h < this.water + 0.8 || flow >= RIVER_FLOW) return;
    const hRel = (h - this.lo) / this.range;
    const line = 0.66 + 0.2 * (valueNoise2(x / 140, z / 140, this.sLine) - 0.5);
    if (hRel >= line) return;
    const wet = f.wetness(x, z);
    const base = smoothstep(0.3, 0.55, soil) * (1 - smoothstep(0.3, MAX_TAN, tan)) * (1 - smoothstep(line - 0.14, line, hRel)) * (1 - smoothstep(0.6, RIVER_FLOW, flow));
    out.density = Math.min(0.85, treeMax * (0.55 + 0.9 * wet)) * base;
    const r2 = this.draw(cx, cz, 1), r3 = this.draw(cx, cz, 2), r4 = this.draw(cx, cz, 3), r5 = this.draw(cx, cz, 4);
    const conifer = this.conifer(x, z, hRel, wet);
    const b = 0.85 + 0.3 * r5, hue = (this.draw(cx, cz, 6) - 0.5) * 0.16;
    out.variant = this.species(x, z, r2 < conifer, r3, soil, wet, smoothstep(0.12, 0.55, out.density), false);
    out.tint = this.crownTint(cx, cz, x, z, r2 < conifer, b, hue);
    const age = smoothstep(0.35, 0.65, fbm2(x / 170, z / 170, this.sAge, 2));
    // A card stands for the canopy top, so it takes the emergent conifers' height but not the suppressed trees' (canopyLayer).
    const emergent = r2 < conifer ? 1.05 + (EMERGENT_MAX - 1.05) * this.draw(cx, cz, 17) : 1;
    out.scale = Math.min(Math.max((0.62 + 0.5 * age) * (0.6 + 0.8 * Math.pow(r4, 0.8)) * emergent * (1 - 0.3 * smoothstep(line - 0.25, line, hRel)), MIN_TREE_SCALE), MAX_TREE_SCALE);
  }

  /**
   * A tree's colour multiplier. Seen from above a forest is a patchwork: neighbouring stands differ in shade and hue (age, soil, the mix of
   * species and their health), and within a stand each crown differs again. A stand patch tens of metres across sets a brightness and a
   * yellow-to-blue cast; each tree adds its own on top. Broadleaf crowns differ most (a shaded or sickly crown is a third darker than a
   * vigorous one beside it); conifers' dark needles vary less in hue but still in shade.
   */
  private crownTint(cx: number, cz: number, x: number, z: number, conifer: boolean, b: number, hue: number): number {
    const patch = fbm2(x / 45, z / 45, this.sAge + 9, 2) - 0.5, cast = fbm2(x / 60 + 31, z / 60 - 17, this.sAge + 21, 2) - 0.5;
    const pb = b * (1 + 0.8 * patch) * (conifer ? 0.82 + 0.3 * this.draw(cx, cz, 9) : 0.72 + 0.46 * this.draw(cx, cz, 9));
    const ph = hue * 1.6 + 0.5 * cast;
    return conifer ? pack(pb * (1 + 0.4 * ph), pb, pb * (1 - 0.4 * ph), 1) : pack(pb * (1 + ph), pb, pb * (1 - ph), 1);
  }

  /**
   * Scale factor for a tree's place in the canopy's layers. A closed stand (\`closure\` near 1) is not one even roof: about a quarter of its
   * trees are suppressed, a storey below their neighbours, which opens dark gaps between the crowns that reach the light; conifers rise as
   * spires above the broadleaf roof (a Norway spruce outgrows an oak by a third).
   */
  private canopyLayer(cx: number, cz: number, conifer: boolean, closure: number): number {
    const suppressed = this.draw(cx, cz, 16) < 0.28 * closure ? 0.62 : 1;
    return suppressed * (conifer ? 1.05 + (EMERGENT_MAX - 1.05) * this.draw(cx, cz, 17) : 1);
  }

  /** Rock candidate of fine cell (cx, cz): steep, bare or stream-side ground, in clumps. Fills \`out\` (scale = radius) and returns whether one is wanted. */
  rock(cx: number, cz: number, x: number, z: number, out: Pick): boolean {
    const f = this.f;
    const clump = 0.35 + 1.15 * smoothstep(0.42, 0.62, fbm2(x / 50, z / 50, this.sClump, 2));
    const u = this.draw(cx, cz, 10);
    if (u >= 0.6 * clump) return false;
    const h = f.height(x, z);
    if (h < this.water + 0.3) return false;
    const flow = f.flow(x, z);
    if (flow >= 0.9) return false;
    const steep = smoothstep(0.27, 0.7, f.gradient(x, z));
    const bare = 1 - smoothstep(0.22, 0.4, f.soil(x, z));
    const stream = smoothstep(0.3, 0.55, flow) * (1 - smoothstep(0.8, 0.9, flow));
    if (u >= Math.max(0.5 * steep, 0.6 * bare, 0.35 * stream, 0.02) * clump) return false;
    const r = this.draw(cx, cz, 11);
    const size = Math.min(0.3 * Math.pow(1 - this.draw(cx, cz, 12), -0.6), 4);
    const rocks = VARIANTS_OF.rock;
    if (steep > 0.5) out.variant = r < 0.6 ? rocks[3] : rocks[0];
    else if (bare > 0.5) out.variant = r < 0.55 ? rocks[2] : rocks[0];
    else if (stream > 0.4) out.variant = r < 0.7 ? rocks[1] : rocks[2];
    else out.variant = rocks[r < 0.35 ? 0 : r < 0.65 ? 1 : r < 0.85 ? 2 : 3];
    out.scale = size;
    out.yaw = this.draw(cx, cz, 13) * Math.PI * 2;
    const g = 0.8 + 0.4 * this.draw(cx, cz, 14), warm = (this.draw(cx, cz, 15) - 0.5) * 0.12;
    out.tint = pack(g * (1 + warm), g, g * (1 - warm), 1);
    return true;
  }
}
`,Ix=`import type { Vec3 } from '../../contracts';
import type { RTMaterial, RTPrimitive } from '../contracts';
import { plantSurface } from './plantSurfaces';
import { VARIANT_DEFS, variantPlan } from './variants';
import type { Limb, TreePlan } from './treePlan';

/**
 * Ray-traced shadow stand-ins for one drawn tree: opaque capsules along the trunk and thick limbs, and soft canopy spheres fitted to the
 * leaves. The park's explicit plantings and the natural forest both use these, so a tree casts the shadow of the tree that is drawn.
 */

/** Bulk canopy reflectance (leaves, gaps and bark averaged), lower than a single leaf's 0.1 to 0.15 green. */
export const RT_FOLIAGE: RTMaterial = { albedo: [0.045, 0.09, 0.025], roughness: 1, metalness: 0 };
export const RT_WOOD: RTMaterial = { albedo: [0.13, 0.085, 0.05], roughness: 0.95, metalness: 0 };

/** Most capsules one tree gets for its wood, trunk first and then the thickest limbs. */
export const MAX_WOOD_CAPSULES = 10;
/** Most canopy spheres one tree gets. */
export const MAX_CANOPY_SPHERES = 3;
/** A wood capsule thinner than this (metres, after scale) casts no shadow worth tracing. */
const MIN_CAPSULE_RADIUS = 0.015;
/** Primary limbs thinner than this at their base (metres at scale 1) are left to the canopy. */
const MIN_LIMB_RADIUS = 0.05;
const MAX_TRUNK_CHORDS = 6;
const MAX_LIMB_CHORDS = 2;
const MAX_LIMBS = 3;
/** How much of a capsule's radius the true centreline may stray from its axis. */
const SAG_OF_RADIUS = 0.5;
/** How much wider than its thinnest end a chord's widest end may be, as a fraction. */
const TAPER_PER_CHORD = 0.5;
const WOOD_FILL = 0.9;

export interface WoodCapsule { a: Vec3; b: Vec3; radius: number }
export interface CanopySphere { center: Vec3; radius: number }

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);

function distanceToSegment(p: Vec3, a: Vec3, b: Vec3): number {
  const d = sub(b, a), l2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2] || 1;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1] + (p[2] - a[2]) * d[2]) / l2));
  return len(sub(p, [a[0] + d[0] * t, a[1] + d[1] * t, a[2] + d[2] * t]));
}

/** Breakpoints (indices) of a polyline so that every chord stays within SAG_OF_RADIUS of the thinnest bark it replaces. */
function breakpoints(pts: readonly Vec3[], radii: readonly number[], from: number, to: number, scaleTol: number): number[] {
  const out = [from];
  const split = (i: number, j: number): void => {
    let worst = 0, at = -1, thin = Infinity, thick = 0;
    for (let k = i; k <= j; k++) { thin = Math.min(thin, radii[k]); thick = Math.max(thick, radii[k]); }
    for (let k = i + 1; k < j; k++) { const d = distanceToSegment(pts[k], pts[i], pts[j]); if (d > worst) { worst = d; at = k; } }
    if (at > 0 && worst > Math.max(0.01, SAG_OF_RADIUS * scaleTol * thin)) { split(i, at); split(at, j); }
    // A chord has one radius, so a trunk that tapers a lot within one is cut in half.
    else if (j - i > 1 && thick > (1 + TAPER_PER_CHORD * scaleTol) * thin) { const mid = (i + j) >> 1; split(i, mid); split(mid, j); }
    else out.push(j);
  };
  split(from, to);
  return out;
}

/** Whether one chord from the start of the limb to the point at index end stays within the sag allowance of the bark between. */
function straightEnough(limb: Limb, end: number): boolean {
  let thin = Infinity, worst = 0;
  for (let k = 0; k <= end; k++) thin = Math.min(thin, limb.radii[k]);
  for (let k = 1; k < end; k++) worst = Math.max(worst, distanceToSegment(limb.pts[k], limb.pts[0], limb.pts[end]));
  return worst <= Math.max(0.01, SAG_OF_RADIUS * thin);
}

/** Fewest chords, each within the sag allowance, with the allowance relaxed only as far as needed to respect \`max\`. */
function fitChords(limb: Limb, from: number, to: number, max: number): WoodCapsule[] {
  let tol = 1, marks = breakpoints(limb.pts, limb.radii, from, to, tol);
  while (marks.length - 1 > max && tol < 64) { tol *= 1.4; marks = breakpoints(limb.pts, limb.radii, from, to, tol); }
  const out: WoodCapsule[] = [];
  for (let m = 1; m < marks.length; m++) {
    let sum = 0, n = 0;
    for (let k = marks[m - 1]; k <= marks[m]; k++) { sum += limb.radii[k]; n++; }
    out.push({ a: limb.pts[marks[m - 1]], b: limb.pts[marks[m]], radius: sum / n * WOOD_FILL });
  }
  return out;
}

/** The wood of one variant at scale 1 in the plant's own frame: chords along the trunk from the ground up, and chords along its thickest limbs. */
export interface WoodFit { trunk: readonly WoodCapsule[]; limbs: readonly WoodCapsule[] }

const woodCache = new Map<number, WoodFit>();

/** Index of a stem's first point less than 20 cm under the ground. */
const groundIndex = (stem: Limb): number => Math.max(0, Math.min(stem.pts.findIndex(p => p[1] >= -0.2), stem.pts.length - 2));

export function woodShadowFit(variant: number): WoodFit {
  let fit = woodCache.get(variant);
  if (fit) return fit;
  const plan = variantPlan(variant)!, stems = plan.limbs.filter(limb => limb.order === 0), limbs: WoodCapsule[] = [];
  // Every stem of a clump casts its shadow; the chord budget is shared between them.
  // The part of a stem below the ground casts nothing: chords start at its first point near the surface.
  const trunk = stems.flatMap(stem => fitChords(stem, groundIndex(stem), stem.pts.length - 1, Math.max(2, Math.floor(MAX_TRUNK_CHORDS / stems.length))));
  // Surface roots lie in the ground and cast no shadow worth a capsule.
  const thick = plan.limbs.filter(limb => limb.order === 1 && !limb.root && limb.radii[0] >= MIN_LIMB_RADIUS).sort((a, b) => b.radii[0] - a.radii[0]).slice(0, MAX_LIMBS);
  for (const limb of thick) {
    // The thick root of the limb, as far as one straight chord stays inside its bark and the bark has not thinned to under about half its base.
    let end = 1;
    while (end + 1 < limb.pts.length && limb.radii[end + 1] >= Math.max(0.03, 0.45 * limb.radii[0]) && straightEnough(limb, end + 1)) end++;
    // A limb that bends at once still gets its first two segments, one chord each.
    if (end === 1 && limb.pts.length > 2 && limb.radii[2] >= Math.max(0.03, 0.45 * limb.radii[0])) end = 2;
    limbs.push(...fitChords(limb, 0, end, MAX_LIMB_CHORDS));
  }
  fit = { trunk, limbs };
  woodCache.set(variant, fit);
  return fit;
}

const yawPoint = (pos: Vec3, yaw: number, local: Vec3, scale: number): Vec3 => {
  const c = Math.cos(yaw), s = Math.sin(yaw), x = local[0] * scale, y = local[1] * scale, z = local[2] * scale;
  return [pos[0] + c * x + s * z, pos[1] + y, pos[2] - s * x + c * z];
};

export interface PlantPlacement { pos: Vec3; yaw: number; scale: number }

/** Opaque capsules for the wood of a placed tree, trunk first and then the thickest limbs (trunk only when \`withLimbs\` is false), skipping any too thin to matter at this scale. Bushes have none. */
export function plantWoodShadows(variant: number, at: PlantPlacement, withLimbs = true, max = MAX_WOOD_CAPSULES): RTPrimitive[] {
  const out: RTPrimitive[] = [];
  if (VARIANT_DEFS[variant].group !== 'tree') return out;
  const fit = woodShadowFit(variant);
  for (const capsule of withLimbs ? [...fit.trunk, ...fit.limbs] : fit.trunk) {
    if (out.length >= max) break;
    const radius = capsule.radius * at.scale;
    if (radius < MIN_CAPSULE_RADIUS) continue;
    out.push({ type: 'capsule', a: yawPoint(at.pos, at.yaw, capsule.a, at.scale), b: yawPoint(at.pos, at.yaw, capsule.b, at.scale), radius, material: RT_WOOD });
  }
  return out;
}

// ----- canopy -----

const canopyCache = new Map<number, CanopySphere[]>();

/** The old stand-in: one sphere of the same volume as the planned crown ellipsoid, at its centre. */
function crownSphere(plan: TreePlan): CanopySphere {
  return { center: plan.crownC, radius: Math.cbrt(plan.crownR[0] * plan.crownR[1] * plan.crownR[2]) };
}

/** Lloyd's k-means, started from evenly spaced heights, each sphere sized to the spread of its own leaves (a solid ball has mean square radius 3/5 R^2). */
function ballsOf(points: Float32Array, k: number): CanopySphere[] {
  const n = points.length / 3;
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < n; i++) { lo = Math.min(lo, points[i * 3 + 1]); hi = Math.max(hi, points[i * 3 + 1]); }
  const centres: Vec3[] = [];
  for (let c = 0; c < k; c++) {
    const y = lo + (hi - lo) * (c + 0.5) / k;
    let best = 0, bd = Infinity;
    for (let i = 0; i < n; i++) { const d = Math.abs(points[i * 3 + 1] - y); if (d < bd) { bd = d; best = i; } }
    centres.push([points[best * 3], points[best * 3 + 1], points[best * 3 + 2]]);
  }
  const owner = new Int32Array(n), sums = centres.map(() => [0, 0, 0, 0]);
  const assign = (): void => {
    for (const s of sums) s.fill(0);
    for (let i = 0; i < n; i++) {
      let bi = 0, bd = Infinity;
      for (let c = 0; c < k; c++) { const d = (points[i * 3] - centres[c][0]) ** 2 + (points[i * 3 + 1] - centres[c][1]) ** 2 + (points[i * 3 + 2] - centres[c][2]) ** 2; if (d < bd) { bd = d; bi = c; } }
      owner[i] = bi; const s = sums[bi]; s[0] += points[i * 3]; s[1] += points[i * 3 + 1]; s[2] += points[i * 3 + 2]; s[3]++;
    }
  };
  for (let iteration = 0; iteration < 24; iteration++) { assign(); for (let c = 0; c < k; c++) if (sums[c][3]) centres[c] = [sums[c][0] / sums[c][3], sums[c][1] / sums[c][3], sums[c][2] / sums[c][3]]; }
  assign();
  const spread = centres.map(() => 0);
  for (let i = 0; i < n; i++) spread[owner[i]] += (points[i * 3] - centres[owner[i]][0]) ** 2 + (points[i * 3 + 1] - centres[owner[i]][1]) ** 2 + (points[i * 3 + 2] - centres[owner[i]][2]) ** 2;
  return centres.map((center, c) => ({ center, radius: Math.sqrt(5 / 3 * spread[c] / Math.max(1, sums[c][3])) })).filter((_, c) => sums[c][3] > 0);
}

/** Points spread evenly over every drawn leaf and needle card, no farther apart than \`spacing\` metres, so a big flat frond counts for its area and not for its four corners. */
export function denseLeafPoints(variant: number, spacing: number): Float32Array {
  const tris = plantSurface(variant).leafTriangles, out: number[] = [];
  for (let t = 0; t < tris.length; t += 9) {
    const edge = (p: number, q: number): number => Math.hypot(tris[t + p * 3] - tris[t + q * 3], tris[t + p * 3 + 1] - tris[t + q * 3 + 1], tris[t + p * 3 + 2] - tris[t + q * 3 + 2]);
    const n = Math.max(1, Math.min(32, Math.ceil(Math.max(edge(0, 1), edge(1, 2), edge(2, 0)) / spacing)));
    const at = (u: number, v: number): void => { for (let k = 0; k < 3; k++) out.push(tris[t + k] + (tris[t + 3 + k] - tris[t + k]) * u + (tris[t + 6 + k] - tris[t + k]) * v); };
    for (let i = 0; i < n; i++) for (let j = 0; j < n - i; j++) { at((i + 1 / 3) / n, (j + 1 / 3) / n); if (i + j < n - 1) at((i + 2 / 3) / n, (j + 2 / 3) / n); }
  }
  return Float32Array.from(out);
}

/** Overlap (intersection over union) between the volume the drawn leaves fill and the volume of the spheres, on a grid of \`cell\`-metre voxels. */
export function canopyOverlap(points: Float32Array, spheres: readonly CanopySphere[], cell: number): number {
  const key = (x: number, y: number, z: number): number => ((x + 512) * 1024 + (y + 512)) * 1024 + (z + 512);
  const drawn = new Set<number>();
  for (let i = 0; i < points.length; i += 3) {
    const x = Math.floor(points[i] / cell), y = Math.floor(points[i + 1] / cell), z = Math.floor(points[i + 2] / cell);
    drawn.add(key(x, y, z));
  }
  const filled = new Set<number>();
  for (const s of spheres) {
    const r = Math.ceil(s.radius / cell) + 1, cx = Math.floor(s.center[0] / cell), cy = Math.floor(s.center[1] / cell), cz = Math.floor(s.center[2] / cell);
    for (let x = cx - r; x <= cx + r; x++) for (let y = cy - r; y <= cy + r; y++) for (let z = cz - r; z <= cz + r; z++) {
      if (Math.hypot((x + 0.5) * cell - s.center[0], (y + 0.5) * cell - s.center[1], (z + 0.5) * cell - s.center[2]) <= s.radius) filled.add(key(x, y, z));
    }
  }
  let both = 0;
  for (const k of filled) if (drawn.has(k)) both++;
  return both / (filled.size + drawn.size - both || 1);
}

/** A sphere count past the first is kept only if it raises the overlap with the drawn leaves by at least this much. */
const EXTRA_SPHERE_GAIN = 0.05;

/** Canopy spheres of a variant at scale 1 in the plant's frame: the 1-3 spheres whose volume best matches the volume its leaves fill. */
export function canopyShadowFit(variant: number): readonly CanopySphere[] {
  let fit = canopyCache.get(variant);
  if (fit) return fit;
  const plan = variantPlan(variant)!, cell = Math.max(0.05, Math.max(...plan.crownR) / 14), leaves = denseLeafPoints(variant, cell / 2);
  let best: CanopySphere[] = [crownSphere(plan)], score = canopyOverlap(leaves, best, cell);
  const moment = ballsOf(leaves, 1), momentScore = canopyOverlap(leaves, moment, cell);
  if (momentScore > score) { best = moment; score = momentScore; }
  for (let k = 2; k <= MAX_CANOPY_SPHERES; k++) {
    const balls = ballsOf(leaves, k), s = canopyOverlap(leaves, balls, cell);
    if (s >= score + EXTRA_SPHERE_GAIN) { best = balls; score = s; }
  }
  fit = best; canopyCache.set(variant, fit);
  return fit;
}

/** Soft canopy spheres for a placed tree. */
export function plantCanopyShadows(variant: number, at: PlantPlacement): RTPrimitive[] {
  return canopyShadowFit(variant).map(s => ({ type: 'sphere', center: yawPoint(at.pos, at.yaw, s.center, at.scale), radius: s.radius * at.scale, material: RT_FOLIAGE }));
}
`,Lx=`import type { Vec3 } from '../../contracts';
import { KIND } from './meshBuilder';
import { variantLods, variantPlan } from './variants';

/**
 * What is drawn for one plant variant at scale 1, in the plant's own frame (yaw 0, root at the origin), sampled so a generator can ask
 * "does this tree, as drawn, touch that building?" without building a mesh per tree.
 */
export interface PlantSurface {
  /** Points through the volume of the trunk and the thicker primary limbs: a point on the axis, a ring half way out and a ring at the bark, at stations less than half a radius apart. xyz per point. */
  wood: Float32Array;
  /** Corners and centres of the leaf and needle cards of the full-detail mesh, xyz per point. */
  leaves: Float32Array;
  /** Every leaf and needle card triangle of the full-detail mesh, nine floats (three corners) per triangle. */
  leafTriangles: Float32Array;
}

/** The thinnest primary limb (base radius, metres) that is worth sampling. */
const MIN_LIMB_RADIUS = 0.045;
/** The trunk's root flare swells the drawn bark past the planned radius by up to this fraction. */
const ROOT_FLARE = 1.25;
/** Points below this height (metres at scale 1) are the root sunk into the soil, which is meant to be underground. */
export const ROOT_DEPTH = 0.02;
const MAX_WOOD_POINTS = 24000;
/** Station spacing as a fraction of the bark radius, and the closest and farthest spacing allowed (metres). */
const SPACING = 0.5;
const MIN_STEP = 0.04;
const MAX_STEP = 0.4;
/** Height (metres at scale 1) below which the trunk is sampled at the closest spacing. */
const ROOT_ZONE = 0.8;
const INNER_POINTS = 6;
const BARK_POINTS = 12;

const cache = new Map<number, PlantSurface>();

/** Points through every thick woody segment of a plan: the trunk and its primary limbs, at the radius the bark is drawn at. */
function woodPoints(variant: number): number[] {
  const plan = variantPlan(variant)!, out: number[] = [];
  const limbs = plan.limbs.filter(limb => limb.order === 0 || (limb.order === 1 && limb.radii[0] >= MIN_LIMB_RADIUS));
  const stride = Math.max(1, Math.ceil(limbs.length * 120 * (INNER_POINTS + BARK_POINTS + 1) / MAX_WOOD_POINTS));
  limbs.forEach((limb, li) => {
    if (limb.order === 1 && li % stride) return;
    const flare = limb.order === 0 ? ROOT_FLARE : 1;
    const station = (p: Vec3, tangent: Vec3, radius: number): void => {
      const ref: Vec3 = Math.abs(tangent[1]) < 0.95 ? [0, 1, 0] : [1, 0, 0];
      const u = [tangent[1] * ref[2] - tangent[2] * ref[1], tangent[2] * ref[0] - tangent[0] * ref[2], tangent[0] * ref[1] - tangent[1] * ref[0]], ul = Math.hypot(u[0], u[1], u[2]) || 1;
      const uu: Vec3 = [u[0] / ul, u[1] / ul, u[2] / ul], w: Vec3 = [tangent[1] * uu[2] - tangent[2] * uu[1], tangent[2] * uu[0] - tangent[0] * uu[2], tangent[0] * uu[1] - tangent[1] * uu[0]];
      const add = (x: number, y: number, z: number): void => { if (y >= ROOT_DEPTH) out.push(x, y, z); };
      add(p[0], p[1], p[2]);
      for (const [count, fraction] of [[INNER_POINTS, 0.5], [BARK_POINTS, 1]] as const) for (let k = 0; k < count; k++) {
        const ang = k / count * Math.PI * 2 + (fraction < 1 ? Math.PI / count : 0), c = Math.cos(ang) * radius * fraction, s = Math.sin(ang) * radius * fraction;
        add(p[0] + uu[0] * c + w[0] * s, p[1] + uu[1] * c + w[1] * s, p[2] + uu[2] * c + w[2] * s);
      }
    };
    for (let i = 0; i + 1 < limb.pts.length; i++) {
      const a = limb.pts[i], b = limb.pts[i + 1], length = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) || 1e-6;
      const tangent: Vec3 = [(b[0] - a[0]) / length, (b[1] - a[1]) / length, (b[2] - a[2]) / length];
      // Near the ground the stations are close enough that none can step over a kerb only a few centimetres tall.
      const r0 = limb.radii[i] * flare, r1 = limb.radii[i + 1] * flare, low = limb.order === 0 && Math.min(a[1], b[1]) < ROOT_ZONE;
      const step = low ? MIN_STEP : Math.min(MAX_STEP, Math.max(MIN_STEP, SPACING * Math.min(r0, r1))), n = Math.ceil(length / step);
      for (let k = 0; k < n; k++) { const f = k / n; station([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f], tangent, r0 + (r1 - r0) * f); }
      if (i + 2 === limb.pts.length) station(b, tangent, r1);
    }
  });
  return out;
}

/** Every leaf and needle card triangle of the full-detail mesh, as corner positions. */
function leafCorners(variant: number): number[] {
  const mesh = variantLods(variant)[0], out: number[] = [];
  for (let t = 0; t < mesh.idx.length; t += 3) {
    const a = mesh.idx[t], b = mesh.idx[t + 1], c = mesh.idx[t + 2];
    if (mesh.attr[a * 4 + 2] < KIND.leaf) continue;
    for (const v of [a, b, c]) for (let k = 0; k < 3; k++) out.push(mesh.pos[v * 3 + k]);
  }
  return out;
}

/** The centre and corners of every second card triangle, which is where a card pokes through a wall first. */
function leafPoints(corners: Float32Array): number[] {
  const out: number[] = [];
  for (let t = 0; t < corners.length; t += 9) {
    if (t / 9 % 2) continue;
    for (let k = 0; k < 3; k++) out.push((corners[t + k] + corners[t + 3 + k] + corners[t + 6 + k]) / 3);
    for (let k = 0; k < 9; k++) out.push(corners[t + k]);
  }
  return out;
}

/** The sampled drawn surface of a plant variant (memoised; deterministic per variant). Rocks have none. */
export function plantSurface(variant: number): PlantSurface {
  let surface = cache.get(variant);
  if (!surface) {
    const wood = Float32Array.from(woodPoints(variant));
    const leafTriangles = Float32Array.from(leafCorners(variant));
    surface = { wood, leaves: Float32Array.from(leafPoints(leafTriangles)), leafTriangles };
    cache.set(variant, surface);
  }
  return surface;
}
`,Rx=`import type { TrackData } from '../../contracts';
import { hash2 } from './noise';

/** Side of a placement cell in metres; cells are anchored to world coordinates so candidates never depend on the region. */
export const COARSE = 24;
const DIAG = COARSE * Math.SQRT2;

export interface Region {
  /** Cell (i, j) covers x in [(i0 + i) * COARSE, (i0 + i + 1) * COARSE) and likewise for z. */
  i0: number;
  j0: number;
  nx: number;
  nz: number;
  /** Approximate distance from each cell centre to the racing line (or to the region centre), in metres. */
  dist: Float32Array;
  /** Indices j * nx + i of the cells within the radius, closest first (a jittered rank so the outline is not a clean contour). */
  order: Int32Array;
}

/** Chamfer distance transform of the cells touched by the path. */
function pathDistances(path: readonly (readonly number[])[], i0: number, j0: number, nx: number, nz: number): Float32Array {
  const d = new Float32Array(nx * nz).fill(Infinity);
  for (const p of path) {
    const i = Math.floor(p[0] / COARSE) - i0, j = Math.floor(p[2] / COARSE) - j0;
    if (i >= 0 && j >= 0 && i < nx && j < nz) d[j * nx + i] = 0;
  }
  const relax = (c: number, i: number, j: number, di: number, dj: number, w: number): number => {
    const a = i + di, b = j + dj;
    return a >= 0 && b >= 0 && a < nx && b < nz ? Math.min(d[c], d[b * nx + a] + w) : d[c];
  };
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const c = j * nx + i;
      d[c] = relax(c, i, j, -1, 0, COARSE);
      d[c] = relax(c, i, j, -1, -1, DIAG);
      d[c] = relax(c, i, j, 0, -1, COARSE);
      d[c] = relax(c, i, j, 1, -1, DIAG);
    }
  }
  for (let j = nz - 1; j >= 0; j--) {
    for (let i = nx - 1; i >= 0; i--) {
      const c = j * nx + i;
      d[c] = relax(c, i, j, 1, 0, COARSE);
      d[c] = relax(c, i, j, 1, 1, DIAG);
      d[c] = relax(c, i, j, 0, 1, COARSE);
      d[c] = relax(c, i, j, -1, 1, DIAG);
    }
  }
  return d;
}

/**
 * Cells within \`radius\` of the racing line (or of \`centre\` without a track) inside \`bounds\` = [minX, minZ, maxX, maxZ], nearest first.
 * Placement walks them in this order, so a cap on the instance count keeps the ground nearest the track.
 */
export function buildRegion(track: TrackData | null, centre: readonly [number, number], radius: number, bounds: readonly [number, number, number, number], seed: number): Region {
  const path = track && track.path.length > 0 ? track.path : null;
  let x0 = centre[0], z0 = centre[1], x1 = centre[0], z1 = centre[1];
  if (path) {
    x0 = Infinity; z0 = Infinity; x1 = -Infinity; z1 = -Infinity;
    for (const p of path) {
      x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]);
      z0 = Math.min(z0, p[2]); z1 = Math.max(z1, p[2]);
    }
  }
  const i0 = Math.floor(Math.max(x0 - radius, bounds[0]) / COARSE), j0 = Math.floor(Math.max(z0 - radius, bounds[1]) / COARSE);
  const nx = Math.max(Math.floor(Math.min(x1 + radius, bounds[2]) / COARSE) - i0 + 1, 1);
  const nz = Math.max(Math.floor(Math.min(z1 + radius, bounds[3]) / COARSE) - j0 + 1, 1);
  let dist: Float32Array;
  if (path) dist = pathDistances(path, i0, j0, nx, nz);
  else {
    dist = new Float32Array(nx * nz);
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) dist[j * nx + i] = Math.hypot((i0 + i + 0.5) * COARSE - centre[0], (j0 + j + 0.5) * COARSE - centre[1]);
    }
  }
  const key = new Float32Array(nx * nz);
  let n = 0;
  const keep = new Int32Array(nx * nz);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const c = j * nx + i;
      if (dist[c] > radius) continue;
      key[c] = dist[c] + COARSE * hash2(i0 + i, j0 + j, seed);
      keep[n++] = c;
    }
  }
  const order = keep.slice(0, n).sort((a, b) => key[a] - key[b] || a - b);
  return { i0, j0, nx, nz, dist, order };
}
`,zx=`import { DEPTH_STATE, GBUFFER_TARGETS, type RenderContext } from '../contracts';

/** Commands are static, but the buffers they reference (uniforms, instances and indirect arguments) remain GPU-dynamic. */
export class VegetationRenderBundle {
  private bundles: GPURenderBundle[] | null = null;
  private device: GPUDevice | null = null;
  private frame: GPUBindGroup | null = null;
  private world: GPUBindGroup | null = null;
  private frameLayout: GPUBindGroupLayout | null = null;
  private worldLayout: GPUBindGroupLayout | null = null;

  /** Resource owners call this before replacing/destroying any system, buffer, bind group or pipeline. */
  invalidate(): void {
    this.bundles = null;
    this.device = null;
    this.frame = this.world = null;
    this.frameLayout = this.worldLayout = null;
  }

  encode(pass: GPURenderPassEncoder, rc: RenderContext, draw: (encoder: GPURenderBundleEncoder) => void): void {
    if (!this.bundles || this.device !== rc.device || this.frame !== rc.frame.group || this.world !== rc.world.group
      || this.frameLayout !== rc.frame.layout || this.worldLayout !== rc.world.layout) {
      const encoder = rc.device.createRenderBundleEncoder({
        label: 'vegetation-gbuffer',
        colorFormats: GBUFFER_TARGETS.map(target => target.format),
        depthStencilFormat: DEPTH_STATE.format,
        // The G-buffer textures and vegetation pipelines both use the default sample count (1).
        sampleCount: 1,
      });
      encoder.setBindGroup(0, rc.frame.group);
      encoder.setBindGroup(1, rc.world.group);
      draw(encoder);
      this.bundles = [encoder.finish()];
      this.device = rc.device;
      this.frame = rc.frame.group;
      this.world = rc.world.group;
      this.frameLayout = rc.frame.layout;
      this.worldLayout = rc.world.layout;
    }
    pass.executeBundles(this.bundles);
    // executeBundles clears ALL pass bindings. Later modules rely on these shared groups being bound.
    pass.setBindGroup(0, rc.frame.group);
    pass.setBindGroup(1, rc.world.group);
  }
}
`,Bx=`import type { Vec3 } from '../../contracts';
import { Rng, deriveSeed } from '../../world/track/rng';
import { MeshBuilder, add, cross, dot, mul, norm, sub, type MeshData } from './meshBuilder';
import { fbm3, smoothstep } from './noise';

export const ROCK_SHAPES = 4;
/** Geodesic frequency per LOD: 20 n^2 triangles, i.e. 500, 80 and 20. */
export const ROCK_FREQUENCY = [5, 2, 1] as const;

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const T = (1 + Math.sqrt(5)) / 2;
const ICO_VERTS: Vec3[] = [[-1, T, 0], [1, T, 0], [-1, -T, 0], [1, -T, 0], [0, -1, T], [0, 1, T], [0, -1, -T], [0, 1, -T], [T, 0, -1], [T, 0, 1], [-T, 0, -1], [-T, 0, 1]];
const ICO_FACES = [
  [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
  [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
];

/** Icosahedron with every edge split n times, projected to the unit sphere; vertices are shared between faces. */
export function icosphere(n: number): { dirs: Vec3[]; tris: number[] } {
  const dirs: Vec3[] = [], tris: number[] = [], seen = new Map<string, number>();
  const at = (p: Vec3): number => {
    const d = norm(p), key = \`\${Math.round(d[0] * 1e5)},\${Math.round(d[1] * 1e5)},\${Math.round(d[2] * 1e5)}\`;
    let id = seen.get(key);
    if (id === undefined) { id = dirs.length; seen.set(key, id); dirs.push(d); }
    return id;
  };
  for (const [ia, ib, ic] of ICO_FACES) {
    const a = ICO_VERTS[ia], b = ICO_VERTS[ib], c = ICO_VERTS[ic];
    const grid = (i: number, j: number): number => at(add(a, add(mul(sub(b, a), i / n), mul(sub(c, a), j / n))));
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n - i; j++) {
        tris.push(grid(i, j), grid(i + 1, j), grid(i, j + 1));
        if (j < n - i - 1) tris.push(grid(i + 1, j), grid(i + 1, j + 1), grid(i, j + 1));
      }
    }
  }
  return { dirs, tris };
}

interface RockShape {
  planes: [Vec3, number][];
  sharp: number;
  stretch: Vec3;
  amp: number;
  freq: number;
  facet: number;
  ledge: number;
  seed: number;
}

function randomPlane(rng: Rng, flatten: number): Vec3 {
  const y = rng.range(-1, 1) * flatten, a = rng.range(0, Math.PI * 2), r = Math.sqrt(Math.max(1 - y * y, 0));
  return norm([r * Math.cos(a), y, r * Math.sin(a)]);
}

/** 0 angular block, 1 rounded boulder, 2 flat slab, 3 tall chunk: a convex polytope of random cut planes with a smooth-min bevel. */
function shapeOf(shape: number): RockShape {
  const rng = new Rng(deriveSeed(0x2c0c, shape));
  const cut = (k: number, flatten: number, lo: number, hi: number): [Vec3, number][] => Array.from({ length: k }, () => [randomPlane(rng, flatten), rng.range(lo, hi)]);
  const seed = deriveSeed(0x2c0d, shape);
  switch (shape) {
    case 0: return { planes: cut(11, 1, 0.78, 1), sharp: 26, stretch: [1, 0.9, 1.05], amp: 0.05, freq: 2.6, facet: 0.55, ledge: 0.03, seed };
    case 1: return { planes: cut(7, 1, 0.86, 1), sharp: 7, stretch: [1.05, 0.8, 0.95], amp: 0.07, freq: 1.6, facet: 0, ledge: 0, seed };
    case 2: return { planes: [[[0, 1, 0], 0.4], [[0, -1, 0], 0.4], ...cut(6, 0.3, 0.82, 1)], sharp: 22, stretch: [1, 1, 0.8], amp: 0.04, freq: 2.2, facet: 0.4, ledge: 0.06, seed };
    default: return { planes: cut(9, 1, 0.8, 1), sharp: 16, stretch: [0.7, 1.35, 0.75], amp: 0.06, freq: 2.2, facet: 0.35, ledge: 0.04, seed };
  }
}

/** Surface point of the rock along unit direction d: polytope radius, low-frequency displacement, facet quantisation and strata ledges. */
function surfacePoint(s: RockShape, d: Vec3): Vec3 {
  const ray = s.planes.map(([n, h]) => { const c = dot(d, n); return c > 0.02 ? h / c : Infinity; });
  const m = Math.min(...ray);
  let sum = 0;
  for (const v of ray) if (v < Infinity) sum += Math.exp(-s.sharp * (v - m));
  let r = m === Infinity ? 1.4 : Math.min(m - Math.log(sum) / s.sharp, 1.6);
  const q = fbm3(d[0] * s.freq + 3.1, d[1] * s.freq, d[2] * s.freq, s.seed, 3);
  r *= 1 + s.amp * (2 * lerp(q, Math.floor(q * 6) / 6, s.facet) - 1);
  let p = mul(d, r);
  if (s.ledge > 0) {
    const t = p[1] * 3.5 + 1.5 * q, k = 1 + s.ledge * (t - Math.floor(t) - 0.5);
    p = [p[0] * k, p[1], p[2] * k];
  }
  return [p[0] * s.stretch[0], p[1] * s.stretch[1], p[2] * s.stretch[2]];
}

export interface RockAsset {
  lods: [MeshData, MeshData, MeshData];
  /** Mesh height above its base (the mesh sits on y = 0) and the bounding sphere about (0, centreY, 0). */
  height: number;
  centreY: number;
  radius: number;
}

function smoothMesh(pos: Vec3[], dirs: Vec3[], tris: number[]): MeshData {
  const acc: Vec3[] = pos.map(() => [0, 0, 0]);
  for (let t = 0; t < tris.length; t += 3) {
    const a = pos[tris[t]], b = pos[tris[t + 1]], c = pos[tris[t + 2]];
    let n = cross(sub(b, a), sub(c, a));
    if (dot(n, add(a, add(b, c))) < 0) n = mul(n, -1);
    for (let k = 0; k < 3; k++) acc[tris[t + k]] = add(acc[tris[t + k]], n);
  }
  const b = new MeshBuilder();
  pos.forEach((p, i) => {
    b.vertex({ p, n: acc[i], u: 0, v: 0, ao: 0.4 + 0.6 * smoothstep(-0.7, 0.5, dirs[i][1]), sway: 0, kind: 0, phase: 0 });
  });
  for (let t = 0; t < tris.length; t += 3) b.tri(tris[t], tris[t + 1], tris[t + 2]);
  return b.build();
}

/** One rock shape at all LODs, scaled so its farthest surface point is 1 m from the centre and moved to rest on y = 0. */
export function buildRock(shape: number): RockAsset {
  const s = shapeOf(shape);
  const fine = icosphere(ROCK_FREQUENCY[0]);
  let maxR = 0, minY = Infinity, maxY = -Infinity;
  for (const d of fine.dirs) {
    const p = surfacePoint(s, d);
    maxR = Math.max(maxR, Math.hypot(p[0], p[1], p[2]));
    minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]);
  }
  const k = 1 / maxR, lift = -minY * k;
  const lods = ROCK_FREQUENCY.map((n) => {
    const ico = n === ROCK_FREQUENCY[0] ? fine : icosphere(n);
    const pos = ico.dirs.map((d): Vec3 => { const p = surfacePoint(s, d); return [p[0] * k, p[1] * k + lift, p[2] * k]; });
    return smoothMesh(pos, ico.dirs, ico.tris);
  }) as [MeshData, MeshData, MeshData];
  const height = (maxY - minY) * k;
  let radius = 0;
  for (const m of lods) for (let i = 0; i < m.vertexCount; i++) radius = Math.max(radius, Math.hypot(m.pos[i * 3], m.pos[i * 3 + 1] - height / 2, m.pos[i * 3 + 2]));
  return { lods, height, centreY: height / 2, radius };
}

let cache: RockAsset[] | null = null;

/** The four rock shapes, built once (they do not depend on the scene). */
export function rockAssets(): readonly RockAsset[] {
  cache ??= Array.from({ length: ROCK_SHAPES }, (_, i) => buildRock(i));
  return cache;
}
`,Vx=`/** A long CPU job written as a generator that yields at safe points, so one body serves both the sync build and the time-sliced one. */
export type Steps<T> = Generator<void, T, void>;

export function runSync<T>(steps: Steps<T>): T {
  let r = steps.next();
  while (!r.done) r = steps.next();
  return r.value;
}

/** Lets the event loop paint and handle input: a macrotask hop (MessageChannel avoids the 4 ms setTimeout clamp). */
export function yieldToEvents(): Promise<void> {
  if (typeof MessageChannel === 'undefined') return new Promise((resolve) => setTimeout(resolve, 0));
  return new Promise((resolve) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = (): void => { ch.port1.close(); resolve(); };
    ch.port2.postMessage(0);
  });
}

/** Runs the steps in slices of about \`budgetMs\`, yielding to the event loop between slices; the result is the one runSync gives. */
export async function runSliced<T>(steps: Steps<T>, budgetMs = 8, yieldFn: () => Promise<void> = yieldToEvents): Promise<T> {
  let start = performance.now();
  let r = steps.next();
  while (!r.done) {
    if (performance.now() - start >= budgetMs) {
      await yieldFn();
      start = performance.now();
    }
    r = steps.next();
  }
  return r.value;
}
`,Hx=`/**
 * The runtime import closure of a module, read from raw sources (import.meta.glob '?raw'), for cache keys that must change whenever any
 * code a result depends on changes, and only then (treeCache.ts). Paths are posix and relative to the repo root ('src/...').
 *
 * Type-only imports (\`import type\`, \`export type ... from\`, or a brace list of \`type\` names only) are left out: they erase at build time.
 * import.meta.glob calls with literal patterns add the files they select (a '?raw' glob as text only, a code glob with its imports). An
 * import that resolves to no file in \`sources\` (a package, a path outside the globbed set, a computed specifier or glob) is listed in
 * \`missing\`, so the caller can refuse to cache rather than miss a dependency.
 */

export interface Closure {
  /** Every file reached, entries included, sorted. */
  files: string[];
  /** Imports that could not be followed, as \`importer -> specifier\`. */
  missing: string[];
}

/** One static import or re-export (or dynamic import, worker URL) of a module: its specifier and the local names it binds ([] when none). */
interface ImportRef { spec: string; names: string[]; typeOnly: boolean }

const STATIC = /(?:^|[;}\\n])[ \\t]*(import|export)\\s+(type\\s+)?([\\w$*{}\\s,]*?)\\s*from\\s*['"]([^'"\\n]+)['"]/g;
const BARE = /(?:^|[;}\\n])[ \\t]*import\\s*['"]([^'"\\n]+)['"]/g;
const DYNAMIC = /\\bimport\\s*\\(\\s*(['"]?)([^'")\\n]*)\\1\\s*\\)/g;
const WORKER_URL = /\\bnew\\s+URL\\s*\\(\\s*['"]([^'"\\n]+)['"]\\s*,\\s*import\\.meta\\.url\\s*\\)/g;

/** \`text\` with comments blanked (strings and template literals kept), so a commented-out import is not followed. */
export function stripComments(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i], n = text[i + 1];
    if (c === '/' && n === '/') { while (i < text.length && text[i] !== '\\n') i++; out += '\\n'; continue; }
    if (c === '/' && n === '*') { const end = text.indexOf('*/', i + 2); const stop = end < 0 ? text.length : end + 2; out += text.slice(i, stop).replace(/[^\\n]/g, ' '); i = stop - 1; continue; }
    if (c === '"' || c === "'" || c === '\`') {
      let j = i + 1;
      while (j < text.length && text[j] !== c) { if (text[j] === '\\\\') j++; if (c !== '\`' && text[j] === '\\n') break; j++; }
      out += text.slice(i, j + 1); i = j; continue;
    }
    out += c;
  }
  return out;
}

/** The imports of a module's (comment-free) text. */
export function importsOf(text: string): ImportRef[] {
  const refs: ImportRef[] = [];
  for (const m of text.matchAll(STATIC)) {
    const clause = m[3].trim();
    // \`export { a }\` without \`from\` is not matched; \`export * from\` and \`export { a } from\` bind no local names.
    const names: string[] = [];
    let typeOnly = !!m[2];
    if (m[1] === 'import' && !typeOnly) {
      const brace = /\\{([^}]*)\\}/.exec(clause);
      const outside = clause.replace(/\\{[^}]*\\}/, '').split(',').map((s) => s.trim()).filter(Boolean);
      for (const o of outside) names.push(o.replace(/^\\*\\s+as\\s+/, ''));
      const specs = brace ? brace[1].split(',').map((s) => s.trim()).filter(Boolean) : [];
      for (const s of specs) if (!s.startsWith('type ')) names.push(s.split(/\\s+as\\s+/).pop()!.trim());
      typeOnly = outside.length === 0 && specs.length > 0 && specs.every((s) => s.startsWith('type '));
    } else if (m[1] === 'export' && !typeOnly) {
      const brace = /\\{([^}]*)\\}/.exec(clause);
      if (brace) {
        const specs = brace[1].split(',').map((s) => s.trim()).filter(Boolean);
        typeOnly = specs.length > 0 && specs.every((s) => s.startsWith('type '));
      }
    }
    refs.push({ spec: m[4], names, typeOnly });
  }
  for (const m of text.matchAll(BARE)) refs.push({ spec: m[1], names: [], typeOnly: false });
  // A dynamic import of anything but a plain string literal cannot be followed: it is reported as missing.
  for (const m of text.matchAll(DYNAMIC)) refs.push({ spec: m[1] ? m[2] : \`<computed \${m[2].trim()}>\`, names: [], typeOnly: false });
  for (const m of text.matchAll(WORKER_URL)) refs.push({ spec: m[1], names: [], typeOnly: false });
  for (const g of globsOf(text)) refs.push({ spec: g, names: [], typeOnly: false });
  return refs;
}

/**
 * The import.meta.glob calls of a module, each as a specifier \`<glob raw|code pattern,pattern,...>\` (raw: the files are read as text, so
 * they are dependencies without their own imports), or \`<import.meta.glob>\` when a call's patterns are not string literals.
 */
function globsOf(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\\bimport\\.meta\\.glob\\s*(?:<[^>]*>)?\\s*\\(/g)) {
    // The argument list up to the matching parenthesis.
    let depth = 1, j = m.index! + m[0].length;
    for (; j < text.length && depth; j++) depth += text[j] === '(' ? 1 : text[j] === ')' ? -1 : 0;
    const call = text.slice(m.index! + m[0].length, j - 1);
    const first = /^\\s*(\\[[^\\]]*\\]|'[^']*'|"[^"]*")/.exec(call);
    const patterns = first ? [...first[1].matchAll(/'([^']*)'|"([^"]*)"/g)].map((p) => p[1] ?? p[2]) : [];
    if (!first || !patterns.length || /\\$\\{/.test(first[1])) { out.push('<import.meta.glob>'); continue; }
    const raw = /query\\s*:\\s*['"]\\?raw['"]/.test(call.slice(first[0].length));
    out.push(\`<glob \${raw ? 'raw' : 'code'} \${patterns.join(',')}>\`);
  }
  return out;
}

/** The files of \`sources\` a glob's patterns (relative to \`from\`, \`!\` excludes, \`*\` within a name, \`**\` across folders) select. */
function globFiles(from: string, patterns: readonly string[], sources: Readonly<Record<string, string>>): string[] {
  const toRe = (p: string): RegExp | null => {
    const path = join(from, p);
    if (path === null) return null;
    const body = path.split('/').map((s) => (s === '**' ? '(?:.*/)?' : \`\${s.replace(/[.+^\${}()|[\\]\\\\]/g, '\\\\$&').replace(/\\*/g, '[^/]*').replace(/\\?/g, '[^/]')}/\`)).join('');
    return new RegExp(\`^\${body.replace(/\\(\\?:\\.\\*\\/\\)\\?$|\\/$/, '')}$\`);
  };
  const inc = patterns.filter((p) => !p.startsWith('!')).map(toRe), exc = patterns.filter((p) => p.startsWith('!')).map((p) => toRe(p.slice(1)));
  return Object.keys(sources).filter((f) => inc.some((r) => r?.test(f)) && !exc.some((r) => r?.test(f)));
}

/** \`rel\` (posix, may start with ./ or ../) against the directory of \`from\`, normalised; null when it climbs above the root. */
function join(from: string, rel: string): string | null {
  const parts = from.split('/').slice(0, -1);
  for (const p of rel.split('/')) {
    if (p === '' || p === '.') continue;
    if (p === '..') { if (!parts.length) return null; parts.pop(); } else parts.push(p);
  }
  return parts.join('/');
}

function resolveSpec(from: string, spec: string, sources: Readonly<Record<string, string>>): string | null {
  if (!spec.startsWith('.')) return null;
  const base = join(from, spec.replace(/\\?.*$/, ''));
  if (base === null) return null;
  for (const p of [base, \`\${base}.ts\`, \`\${base}/index.ts\`]) if (p in sources) return p;
  return null;
}

/**
 * The closure of \`entries\` over \`sources\` (path -> text). \`prune\` lists files whose imports count only when one of the names they bind is
 * used in the file's own text outside the import statements: the caller has cut part of that file's text out (treeCache.ts drops the
 * variant table, whose effect it keys on each variant's plan output instead).
 */
export function importClosure(sources: Readonly<Record<string, string>>, entries: readonly string[], prune: ReadonlySet<string> = new Set()): Closure {
  const seen = new Set<string>(), raw = new Set<string>(), missing: string[] = [], queue = [...entries];
  for (const e of entries) if (!(e in sources)) missing.push(\`<entry> -> \${e}\`);
  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file) || !(file in sources)) continue;
    seen.add(file);
    const text = stripComments(sources[file]);
    const body = prune.has(file) ? text.replace(STATIC, '\\n').replace(BARE, '\\n') : '';
    for (const ref of importsOf(text)) {
      if (ref.typeOnly) continue;
      const glob = /^<glob (raw|code) (.*)>$/.exec(ref.spec);
      if (glob) {
        for (const f of globFiles(file, glob[2].split(','), sources)) if (glob[1] === 'raw') raw.add(f); else queue.push(f);
        continue;
      }
      if (prune.has(file) && ref.names.length && !ref.names.some((n) => new RegExp(\`(^|[^\\\\w$.])\${n.replace(/\\$/g, '\\\\$')}(?![\\\\w$])\`).test(body))) continue;
      const to = resolveSpec(file, ref.spec, sources);
      if (to === null) missing.push(\`\${file} -> \${ref.spec}\`);
      else queue.push(to);
    }
  }
  return { files: [...new Set([...seen, ...raw])].sort(), missing };
}

/** FNV-1a over \`text\` in two 32-bit lanes with different seeds, as 16 hex digits. */
export function hash64(text: string): string {
  let a = 0x811c9dc5, b = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x01000193 + 2) >>> 0;
  }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}

/**
 * A deterministic text of a plain data value (objects by sorted key, arrays and typed arrays element by element, -0 and NaN kept apart),
 * for hashing a generator's output. Throws on a value it cannot render faithfully (a function, a Map, a class instance with hidden state).
 */
export function stableText(value: unknown): string {
  const out: string[] = [];
  const seen = new Set<object>();
  const walk = (v: unknown): void => {
    if (v === null) { out.push('null'); return; }
    switch (typeof v) {
      case 'number': out.push(Object.is(v, -0) ? '-0' : String(v)); return;
      case 'string': out.push(JSON.stringify(v)); return;
      case 'boolean': out.push(v ? 'true' : 'false'); return;
      case 'undefined': out.push('undefined'); return;
      case 'bigint': out.push(\`\${v}n\`); return;
      case 'object': break;
      default: throw new Error(\`stableText: cannot render a \${typeof v}\`);
    }
    const o = v as object;
    if (seen.has(o)) throw new Error('stableText: cyclic value');
    seen.add(o);
    if (Array.isArray(o)) { out.push('['); for (const x of o) { walk(x); out.push(','); } out.push(']'); }
    else if (ArrayBuffer.isView(o) && !(o instanceof DataView)) {
      out.push(\`\${o.constructor.name}[\`);
      for (const x of o as unknown as Iterable<number>) { walk(x); out.push(','); }
      out.push(']');
    } else if (Object.getPrototypeOf(o) === Object.prototype) {
      out.push('{');
      for (const k of Object.keys(o).sort()) { out.push(JSON.stringify(k), ':'); walk((o as Record<string, unknown>)[k]); out.push(','); }
      out.push('}');
    } else throw new Error(\`stableText: cannot render a \${o.constructor?.name ?? 'object'}\`);
    seen.delete(o);
  };
  walk(value);
  return out.join('');
}
`,Ux=`/** Uniform grid of discs (linked lists in typed arrays) for the Poisson-disc spacing checks; \`cell\` must be at least the largest query radius. */
export class SpatialHash {
  private readonly head: Int32Array;
  private next: Int32Array;
  private xs: Float32Array;
  private zs: Float32Array;
  private rs: Float32Array;
  private gs: Uint8Array;
  private readonly nx: number;
  private readonly nz: number;
  count = 0;

  constructor(private readonly minX: number, private readonly minZ: number, maxX: number, maxZ: number, private readonly cell: number, capacity: number) {
    this.nx = Math.max(1, Math.ceil((maxX - minX) / cell) + 1);
    this.nz = Math.max(1, Math.ceil((maxZ - minZ) / cell) + 1);
    this.head = new Int32Array(this.nx * this.nz).fill(-1);
    this.next = new Int32Array(capacity);
    this.xs = new Float32Array(capacity);
    this.zs = new Float32Array(capacity);
    this.rs = new Float32Array(capacity);
    this.gs = new Uint8Array(capacity);
  }

  private clampX(x: number): number {
    return Math.min(Math.max(Math.floor((x - this.minX) / this.cell), 0), this.nx - 1);
  }

  private clampZ(z: number): number {
    return Math.min(Math.max(Math.floor((z - this.minZ) / this.cell), 0), this.nz - 1);
  }

  add(x: number, z: number, r: number, group: number): void {
    if (this.count === this.xs.length) this.grow();
    const i = this.count++, c = this.clampZ(z) * this.nx + this.clampX(x);
    this.xs[i] = x; this.zs[i] = z; this.rs[i] = r; this.gs[i] = group;
    this.next[i] = this.head[c];
    this.head[c] = i;
  }

  private grow(): void {
    const cap = this.xs.length * 2 + 64;
    const f = (a: Float32Array): Float32Array => { const b = new Float32Array(cap); b.set(a); return b; };
    this.xs = f(this.xs); this.zs = f(this.zs); this.rs = f(this.rs);
    const nx = new Int32Array(cap); nx.set(this.next); this.next = nx;
    const g = new Uint8Array(cap); g.set(this.gs); this.gs = g;
  }

  /** Whether a disc of radius \`r\` and group \`group\` is closer than 0.5 (r + rj) times \`same\` (same group) or \`cross\` (other group) to a stored disc. */
  conflicts(x: number, z: number, r: number, group: number, same: number, cross: number): boolean {
    const cx = this.clampX(x), cz = this.clampZ(z);
    for (let j = Math.max(cz - 1, 0); j <= Math.min(cz + 1, this.nz - 1); j++) {
      for (let i = Math.max(cx - 1, 0); i <= Math.min(cx + 1, this.nx - 1); i++) {
        for (let k = this.head[j * this.nx + i]; k >= 0; k = this.next[k]) {
          const need = 0.5 * (r + this.rs[k]) * (this.gs[k] === group ? same : cross);
          const dx = this.xs[k] - x, dz = this.zs[k] - z;
          if (dx * dx + dz * dz < need * need) return true;
        }
      }
    }
    return false;
  }

  /** Whether the point is within \`r + rj + pad\` of a stored disc. */
  overlaps(x: number, z: number, r: number, pad: number): boolean {
    const cx = this.clampX(x), cz = this.clampZ(z);
    for (let j = Math.max(cz - 1, 0); j <= Math.min(cz + 1, this.nz - 1); j++) {
      for (let i = Math.max(cx - 1, 0); i <= Math.min(cx + 1, this.nx - 1); i++) {
        for (let k = this.head[j * this.nx + i]; k >= 0; k = this.next[k]) {
          const need = r + this.rs[k] + pad;
          const dx = this.xs[k] - x, dz = this.zs[k] - z;
          if (dx * dx + dz * dz < need * need) return true;
        }
      }
    }
    return false;
  }
}
`,Wx=`import type { InstanceSet, VegPlacement } from './placement';
import { VARIANT_DEFS } from './variants';

/** A camera standing point on the ground and the compass heading (degrees clockwise from -Z) to look along. */
export interface ViewSpot {
  x: number;
  z: number;
  yaw: number;
}

const BUCKET = 30;
const LATTICE = 12;
const MIN_TRUNK_GAP = 4;
const MIN_NEIGHBOURS = 40;
const DIRECTIONS = 24;
const CORRIDOR_HALF = 2.5;
const CORRIDOR_START = 3;
const CORRIDOR_END = 30;
const SIDE_BAND = 12;
const DEG = 180 / Math.PI;
const MIN_FIELD_ROCKS = 8;
const BOULDER_WEIGHT = 8;

/** Bucketed positions of the given instances so radius queries touch a handful of cells. */
class Buckets {
  private readonly cells = new Map<number, number[]>();
  private readonly out: number[] = [];

  constructor(private readonly set: InstanceSet, pick: (i: number) => boolean) {
    for (let i = 0; i < set.count; i++) {
      if (!pick(i)) continue;
      const key = this.key(Math.floor(set.pos[i * 3] / BUCKET), Math.floor(set.pos[i * 3 + 2] / BUCKET));
      const list = this.cells.get(key);
      if (list) list.push(i); else this.cells.set(key, [i]);
    }
  }

  private key(cx: number, cz: number): number {
    return (cx + 512) * 1024 + (cz + 512);
  }

  /** Indices of the picked instances in the 3 x 3 buckets around (x, z); reused between calls. */
  near(x: number, z: number): number[] {
    const out = this.out;
    out.length = 0;
    const cx = Math.floor(x / BUCKET), cz = Math.floor(z / BUCKET);
    for (let j = cz - 1; j <= cz + 1; j++) {
      for (let i = cx - 1; i <= cx + 1; i++) {
        const list = this.cells.get(this.key(i, j));
        if (list) for (const k of list) out.push(k);
      }
    }
    return out;
  }
}

/**
 * A clearing inside a wood: at least MIN_TRUNK_GAP from any tree, with a trunk-free lane of CORRIDOR_HALF either side straight ahead
 * and as many trees as possible flanking it. Deterministic (lattice scan, first best wins); null when the placement has no such spot.
 */
export function forestSpot(place: VegPlacement): ViewSpot | null {
  const set = place.plants;
  const trees = new Buckets(set, (i) => VARIANT_DEFS[set.variant[i]].group === 'tree');
  let best: (ViewSpot & { score: number }) | null = null;
  const sin = new Float64Array(DIRECTIONS), cos = new Float64Array(DIRECTIONS);
  for (let d = 0; d < DIRECTIONS; d++) { sin[d] = Math.sin((d / DIRECTIONS) * 2 * Math.PI); cos[d] = -Math.cos((d / DIRECTIONS) * 2 * Math.PI); }
  const blocked = new Uint8Array(DIRECTIONS), flank = new Uint16Array(DIRECTIONS);

  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < set.count; i++) {
    minX = Math.min(minX, set.pos[i * 3]); maxX = Math.max(maxX, set.pos[i * 3]);
    minZ = Math.min(minZ, set.pos[i * 3 + 2]); maxZ = Math.max(maxZ, set.pos[i * 3 + 2]);
  }
  for (let z = minZ; z <= maxZ; z += LATTICE) {
    for (let x = minX; x <= maxX; x += LATTICE) {
      const list = trees.near(x, z);
      if (list.length < MIN_NEIGHBOURS) continue;
      blocked.fill(0); flank.fill(0);
      let tooClose = false;
      for (const i of list) {
        const dx = set.pos[i * 3] - x, dz = set.pos[i * 3 + 2] - z;
        const r2 = dx * dx + dz * dz;
        if (r2 < MIN_TRUNK_GAP * MIN_TRUNK_GAP) { tooClose = true; break; }
        if (r2 > CORRIDOR_END * CORRIDOR_END) continue;
        for (let d = 0; d < DIRECTIONS; d++) {
          const along = dx * sin[d] + dz * cos[d], across = Math.abs(-dx * cos[d] + dz * sin[d]);
          if (along < CORRIDOR_START || along > CORRIDOR_END) continue;
          if (across < CORRIDOR_HALF) blocked[d] = 1;
          else if (across < SIDE_BAND) flank[d]++;
        }
      }
      if (tooClose) continue;
      for (let d = 0; d < DIRECTIONS; d++) {
        if (blocked[d] === 0 && (best === null || flank[d] > best.score)) best = { x, z, yaw: (d / DIRECTIONS) * 360, score: flank[d] };
      }
    }
  }
  return best ? { x: best.x, z: best.z, yaw: best.yaw } : null;
}

/** The camera stands in front of the biggest boulder that has a rock field around it, on the side away from the field's centre, looking at it. */
export function rockSpot(place: VegPlacement): ViewSpot | null {
  const set = place.rocks;
  const buckets = new Buckets(set, () => true);
  let bestScore = 0, bestI = -1, cx = 0, cz = 0;
  for (let i = 0; i < set.count; i++) {
    if (set.scale[i] < 0.8) continue;
    const x = set.pos[i * 3], z = set.pos[i * 3 + 2];
    let n = 0, sx = 0, sz = 0;
    for (const k of buckets.near(x, z)) {
      if (Math.hypot(set.pos[k * 3] - x, set.pos[k * 3 + 2] - z) > 25) continue;
      n++; sx += set.pos[k * 3]; sz += set.pos[k * 3 + 2];
    }
    const score = n >= MIN_FIELD_ROCKS ? n + BOULDER_WEIGHT * set.scale[i] : 0;
    if (score > bestScore) { bestScore = score; bestI = i; cx = sx / n; cz = sz / n; }
  }
  if (bestI < 0) return null;
  const rx = set.pos[bestI * 3], rz = set.pos[bestI * 3 + 2];
  let ax = rx - cx, az = rz - cz;
  const len = Math.hypot(ax, az);
  if (len < 1e-3) { ax = 0; az = 1; } else { ax /= len; az /= len; }
  const stand = 2 + 2.2 * set.scale[bestI];
  const x = rx + ax * stand, z = rz + az * stand;
  return { x, z, yaw: Math.atan2(rx - x, -(rz - z)) * DEG };
}
`,Gx=`import type { TerrainData } from '../../contracts';

/** Bilinear reads of the terrain grids for the placement pass; results land in scratch fields so hot loops never allocate. */
export class TerrainFields {
  /** Terrain gradient (dh/dx, dh/dz) of the last \`gradient\` call. */
  gx = 0;
  gz = 0;
  private readonly n: number;
  private readonly inv: number;
  private readonly ox: number;
  private readonly oz: number;

  constructor(readonly data: TerrainData) {
    this.n = data.resolution;
    this.inv = 1 / data.cellSize;
    this.ox = data.origin[0];
    this.oz = data.origin[1];
  }

  /** True when (x, z) is at least \`margin\` metres inside the sampled area. */
  inside(x: number, z: number, margin: number): boolean {
    const e = (this.n - 1) * this.data.cellSize;
    return x >= this.ox + margin && z >= this.oz + margin && x <= this.ox + e - margin && z <= this.oz + e - margin;
  }

  private bilinear(a: ArrayLike<number>, x: number, z: number): number {
    const last = this.n - 1;
    const tx = Math.min(Math.max((x - this.ox) * this.inv, 0), last - 1e-4);
    const tz = Math.min(Math.max((z - this.oz) * this.inv, 0), last - 1e-4);
    const i = Math.floor(tx), j = Math.floor(tz), fx = tx - i, fz = tz - j;
    const b = j * this.n + i;
    const top = a[b] + (a[b + 1] - a[b]) * fx, bottom = a[b + this.n] + (a[b + this.n + 1] - a[b + this.n]) * fx;
    return top + (bottom - top) * fz;
  }

  /** Height on the drawn mesh: each quad is split along its (0,0)-(1,1) diagonal like TerrainSampler.heightAt, so plants and rocks touch the surface (a bilinear patch is up to about a metre off on 8 m cells). */
  height(x: number, z: number): number {
    const n = this.n, last = n - 1, h = this.data.height;
    const tx = Math.min(Math.max((x - this.ox) * this.inv, 0), last - 1e-4);
    const tz = Math.min(Math.max((z - this.oz) * this.inv, 0), last - 1e-4);
    const i = Math.floor(tx), j = Math.floor(tz), fx = tx - i, fz = tz - j;
    const b = j * n + i, h00 = h[b];
    if (fx >= fz) return h00 + (h[b + 1] - h00) * fx + (h[b + n + 1] - h[b + 1]) * fz;
    return h00 + (h[b + n + 1] - h[b + n]) * fx + (h[b + n] - h00) * fz;
  }

  soil(x: number, z: number): number {
    return this.bilinear(this.data.maps.soil, x, z);
  }

  flow(x: number, z: number): number {
    return this.bilinear(this.data.maps.flow, x, z);
  }

  wetness(x: number, z: number): number {
    return this.bilinear(this.data.maps.wetness, x, z);
  }

  /** Central differences over two cells; the slope angle is atan(hypot(gx, gz)). */
  gradient(x: number, z: number): number {
    const e = this.data.cellSize;
    this.gx = (this.height(x + e, z) - this.height(x - e, z)) / (2 * e);
    this.gz = (this.height(x, z + e) - this.height(x, z - e)) / (2 * e);
    return Math.hypot(this.gx, this.gz);
  }
}
`,Kx=`import type { TerrainData, TrackData, Vec3 } from '../../contracts';
import { createTerrainSampler, generateTerrain } from '../../world/terrain';
import { generateTrack } from '../../world/track/generator';
import { obstacleKeepOuts, tunnelKeepOuts } from '../../world/track/kindGeometry';
import { placeVegetation, TIER_LIMITS, type InstanceSet, type VegPlacement } from './placement';

export interface TestScene {
  terrain: TerrainData;
  track: TrackData;
  high: VegPlacement;
}

let cached: TestScene | null = null;

/** A real 2 km generated terrain, a race track over it and the high-tier placement, built once per test file. */
export function testScene(): TestScene {
  if (!cached) {
    const terrain = generateTerrain({ seed: 7, quality: 'low', resolution: 256, cellSize: 8 });
    const track = generateTrack({ seed: 2, style: 'race' }, createTerrainSampler(terrain));
    cached = { terrain, track, high: placeVegetation(terrain, track, TIER_LIMITS.high) };
  }
  return cached;
}

/** Horizontal distance from (x, z) to the nearest sample of the path. */
export function pathDistance(path: readonly Vec3[], x: number, z: number): number {
  let best = Infinity;
  for (const p of path) best = Math.min(best, Math.hypot(x - p[0], z - p[2]));
  return best;
}

/** Calls \`visit\` for every pair of instances closer than \`reach\` (bucketed, so 20k instances stay cheap). */
export function eachPair(s: InstanceSet, reach: number, visit: (i: number, j: number, d: number) => void): void {
  const cells = new Map<number, number[]>();
  const key = (cx: number, cz: number): number => cx * 100_003 + cz;
  for (let i = 0; i < s.count; i++) {
    const k = key(Math.floor(s.pos[i * 3] / reach), Math.floor(s.pos[i * 3 + 2] / reach));
    const list = cells.get(k);
    if (list) list.push(i); else cells.set(k, [i]);
  }
  for (let i = 0; i < s.count; i++) {
    const cx = Math.floor(s.pos[i * 3] / reach), cz = Math.floor(s.pos[i * 3 + 2] / reach);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        for (const j of cells.get(key(cx + dx, cz + dz)) ?? []) {
          if (j <= i) continue;
          const d = Math.hypot(s.pos[i * 3] - s.pos[j * 3], s.pos[i * 3 + 2] - s.pos[j * 3 + 2]);
          if (d < reach) visit(i, j, d);
        }
      }
    }
  }
}

/** Ground discs the placement keeps clear: gate openings and tunnel sleeves, obstacles and the launch pad (same radii as placement.ts). */
export function blockerDiscs(track: TrackData): { x: number; z: number; r: number }[] {
  const out = track.gates.map((g) => ({ x: g.pos[0], z: g.pos[2], r: 0.5 * Math.hypot(g.width, g.height) + 2 }));
  for (const g of track.gates) if (g.kind === 'tunnel') out.push(...tunnelKeepOuts(g));
  for (const o of track.obstacles) out.push(...obstacleKeepOuts(o));
  out.push({ x: track.start.pos[0], z: track.start.pos[2], r: 8 });
  return out;
}
`,qx=`import { isExtreme, type RenderContext } from '../contracts';
import { DEPTH_STATE, GBUFFER_TARGETS } from '../contracts';
import { EXTREME_TILE_SIZE, TILES_X, TILES_Y, TILE_SIZE, atlasMips, buildLeafAtlasSliced, type LeafAtlas } from './leafAtlas';
import { BARK_NOISE_SIZE, buildBarkNoiseSliced } from './barkNoise';
import { loadBarkScans, scanMipSkip, uploadBarkScans, type BarkScans } from './barkScans';
import { VERTEX_STRIDE, packMeshes } from './meshBuilder';
import { buildTreesInWorkers } from './treeBuildPool';
import { atlasCacheKey, loadCachedAtlas, loadCachedVariant, storeCachedAtlas, storeCachedVariant, treeCacheKey } from './treeCache';
import { DRAW_COUNT, LOD_COUNT, VARIANT_DEFS, buildVariantAssetsSliced, seedVariantLods, isRockVariant, type VariantAsset } from './variants';

export const ARGS_WORDS = 5;
export const ARGS_BYTES = DRAW_COUNT * ARGS_WORDS * 4;

const VERTEX_LAYOUT: GPUVertexBufferLayout = {
  arrayStride: VERTEX_STRIDE,
  attributes: [
    { shaderLocation: 0, offset: 0, format: 'float32x3' },
    { shaderLocation: 1, offset: 12, format: 'unorm16x2' },
    { shaderLocation: 2, offset: 16, format: 'unorm16x2' },
    { shaderLocation: 3, offset: 20, format: 'unorm8x4' },
  ],
};

/**
 * Every variant's meshes (dense: the extreme tier's crowns): each tree variant read from the disk cache (treeCache.ts) where its entry is
 * there, the rest built (on worker threads where there are any, else on this thread, in time slices) and stored; rocks are always built.
 */
async function cachedVariants(dense: boolean): Promise<VariantAsset[]> {
  const trees = VARIANT_DEFS.map((d, v) => (d.rock < 0 ? v : -1)).filter((v) => v >= 0);
  const keys = trees.map((v) => treeCacheKey(v, dense));
  const cached = await Promise.all(trees.map((v, i) => (keys[i] ? loadCachedVariant(keys[i]!, v) : null)));
  const prebuilt: (VariantAsset | null)[] = VARIANT_DEFS.map(() => null);
  trees.forEach((v, i) => { prebuilt[v] = cached[i]; });
  const missing = trees.filter((_, i) => !cached[i]);
  if (missing.length) {
    const built = await buildTreesInWorkers(dense, missing);
    if (built) for (const v of missing) prebuilt[v] = built[v];
  }
  const variants = await buildVariantAssetsSliced(8, undefined, dense, prebuilt);
  await Promise.all(trees.map((v, i) => (!cached[i] && keys[i] ? storeCachedVariant(keys[i]!, variants[v]) : null)));
  return variants;
}

/** GPU objects that do not depend on the scene or the quality tier: meshes, leaf atlas, layouts and pipelines. */
export class TreeAssets {
  readonly variants: VariantAsset[];
  readonly vertexBuffer: GPUBuffer;
  readonly indexBuffer: GPUBuffer;
  /** Indirect draw arguments with instanceCount 0, one entry per (variant, LOD): draw k = variant * LOD_COUNT + lod. */
  readonly argsTemplate: Uint32Array;
  readonly triangles: number[] = [];
  readonly vertexBytes: number;
  readonly indexBytes: number;
  readonly drawLayout: GPUBindGroupLayout;
  readonly cullLayout: GPUBindGroupLayout;
  readonly finalizeLayout: GPUBindGroupLayout;
  readonly atlasView: GPUTextureView;
  readonly atlasDataView: GPUTextureView;
  /** Tileable 3D noise the bark shader samples (barkNoise.ts). */
  readonly barkNoiseView: GPUTextureView;
  /**
   * Photoscanned bark arrays (barkScans.ts) and their repeating, anisotropic sampler. Where the scans are not used (low and medium tiers, no BC
   * compression, file missing) these are one-layer stand-ins, which tells the shader to keep the procedural bark.
   */
  readonly barkColourView: GPUTextureView;
  readonly barkSurfaceView: GPUTextureView;
  readonly barkSampler: GPUSampler;
  cullPipe!: GPUComputePipeline;
  finalizePipe!: GPUComputePipeline;
  /** One tree pipeline per LOD (the shader dithers a LOD in and out of its hand-over bands). */
  treePipes!: GPURenderPipeline[];
  rockPipe!: GPURenderPipeline;
  /** Resolves once the pipelines above have compiled (in the background, so the compile overlaps the later modules' start-up). */
  readonly ready: Promise<void>;
  private readonly atlas: GPUTexture;
  private readonly atlasData: GPUTexture;
  private readonly barkNoise: GPUTexture;
  private readonly barkTextures: GPUTexture[];
  /**
   * The leaf atlas sampler: trilinear, and at the extreme tier with 16x anisotropic filtering, so leaves seen at a slant keep their veins and teeth
   * instead of blurring (it cost about 1 ms of G-buffer at ultra, so the budgeted tiers keep plain trilinear filtering).
   */
  readonly leafSampler: GPUSampler;

  /** Whether the meshes carry the extreme tier's dense crowns (treeGen.ts FoliageOptions). */
  readonly dense: boolean;

  /**
   * Builds the meshes (read from the disk cache, treeCache.ts, or built on worker threads, treeBuildPool.ts, and otherwise on this thread)
   * and the leaf atlas (also cached) in time slices (the loading screen keeps painting), then the GPU objects.
   */
  static async create(rc: RenderContext): Promise<TreeAssets> {
    const dense = isExtreme(rc.quality);
    const tileSize = dense ? EXTREME_TILE_SIZE : TILE_SIZE, atlasKey = atlasCacheKey(tileSize);
    // The cached entries are read and inflated side by side (inflating runs off this thread), so a warm start waits for the largest only.
    // The budgeted tiers' meshes back placement checks and the ray-traced canopy fits (variantLods); at the extreme tier they are the plain
    // set next to the dense one, so they come from the cache too instead of being built again on every start.
    const [variants, cachedPlain, cachedAtlas] = await Promise.all([cachedVariants(dense), dense ? cachedVariants(false) : null, atlasKey ? loadCachedAtlas(atlasKey) : null]);
    const plain = cachedPlain ?? variants;
    seedVariantLods(plain);
    let atlas = cachedAtlas;
    if (!atlas) {
      atlas = await buildLeafAtlasSliced(8, undefined, tileSize);
      if (atlasKey) await storeCachedAtlas(atlasKey, atlas);
    }
    const noise = await buildBarkNoiseSliced();
    const skip = scanMipSkip(rc.quality.tier);
    const scans = skip !== null && rc.features.has('texture-compression-bc') ? await loadBarkScans() : null;
    return new TreeAssets(rc, variants, atlas, noise, dense, scans);
  }

  private constructor(rc: RenderContext, variants: VariantAsset[], atlas: LeafAtlas, barkNoise: Uint8Array, dense: boolean, scans: BarkScans | null) {
    const dev = rc.device;
    this.variants = variants;
    this.dense = dense;
    const packed = packMeshes(this.variants.flatMap((v) => v.lods));
    this.argsTemplate = new Uint32Array(DRAW_COUNT * ARGS_WORDS);
    packed.ranges.forEach((r, k) => {
      this.argsTemplate.set([r.indexCount, 0, r.firstIndex, r.baseVertex, 0], k * ARGS_WORDS);
      this.triangles.push(r.indexCount / 3);
    });
    this.vertexBytes = packed.vertices.byteLength;
    this.indexBytes = packed.indices.byteLength;
    this.vertexBuffer = dev.createBuffer({ label: 'tree-vertices', size: this.vertexBytes, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    dev.queue.writeBuffer(this.vertexBuffer, 0, packed.vertices);
    this.indexBuffer = dev.createBuffer({ label: 'tree-indices', size: this.indexBytes, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
    dev.queue.writeBuffer(this.indexBuffer, 0, packed.indices);

    const atlasTexture = (label: string, levels: Uint8Array[]): GPUTexture => {
      const W = atlas.tileSize * TILES_X, H = atlas.tileSize * TILES_Y;
      const tex = dev.createTexture({ label, size: [W, H], mipLevelCount: atlasMips(atlas.tileSize), format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
      levels.forEach((data, level) => {
        const w = W >> level, h = H >> level;
        dev.queue.writeTexture({ texture: tex, mipLevel: level }, data, { bytesPerRow: w * 4 }, [w, h]);
      });
      return tex;
    };
    this.atlas = atlasTexture('leaf-atlas-colour', atlas.colour);
    this.atlasData = atlasTexture('leaf-atlas-data', atlas.data);
    this.atlasView = this.atlas.createView();
    this.leafSampler = dev.createSampler({ label: 'leaf-atlas', magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge', maxAnisotropy: dense ? 16 : 1 });
    this.atlasDataView = this.atlasData.createView();
    const n = BARK_NOISE_SIZE;
    this.barkNoise = dev.createTexture({ label: 'bark-noise', size: [n, n, n], dimension: '3d', format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    dev.queue.writeTexture({ texture: this.barkNoise }, barkNoise, { bytesPerRow: n * 4, rowsPerImage: n }, [n, n, n]);
    this.barkNoiseView = this.barkNoise.createView({ dimension: '3d' });
    if (scans) {
      const t = uploadBarkScans(dev, scans, scanMipSkip(rc.quality.tier) ?? 0);
      this.barkTextures = [t.colour, t.surface];
    } else {
      const stand = (label: string): GPUTexture => {
        const t = dev.createTexture({ label, size: [1, 1, 1], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
        dev.queue.writeTexture({ texture: t }, new Uint8Array([128, 128, 128, 255]), { bytesPerRow: 4 }, [1, 1, 1]);
        return t;
      };
      this.barkTextures = [stand('bark-scans-none-colour'), stand('bark-scans-none-surface')];
    }
    this.barkColourView = this.barkTextures[0].createView({ dimension: '2d-array' });
    this.barkSurfaceView = this.barkTextures[1].createView({ dimension: '2d-array' });
    this.barkSampler = dev.createSampler({ label: 'bark-scans', magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', addressModeU: 'repeat', addressModeV: 'repeat', maxAnisotropy: dense ? 16 : 8 });

    const C = GPUShaderStage.COMPUTE, V = GPUShaderStage.VERTEX, F = GPUShaderStage.FRAGMENT;
    const buffer = (binding: number, visibility: number, type: GPUBufferBindingType): GPUBindGroupLayoutEntry => ({ binding, visibility, buffer: { type } });
    this.drawLayout = dev.createBindGroupLayout({
      label: 'tree-draw',
      entries: [
        buffer(0, V | F, 'uniform'), buffer(1, V | F, 'read-only-storage'), buffer(2, V, 'read-only-storage'), buffer(3, V | F, 'read-only-storage'),
        { binding: 4, visibility: F, texture: { sampleType: 'float' } },
        { binding: 5, visibility: F, texture: { sampleType: 'float' } },
        { binding: 6, visibility: V | F, texture: { sampleType: 'float', viewDimension: '3d' } },
        { binding: 7, visibility: F, sampler: { type: 'filtering' } },
        { binding: 8, visibility: V | F, texture: { sampleType: 'float', viewDimension: '2d-array' } },
        { binding: 9, visibility: V | F, texture: { sampleType: 'float', viewDimension: '2d-array' } },
        { binding: 10, visibility: V | F, sampler: { type: 'filtering' } },
        buffer(11, F, 'read-only-storage'),
      ],
    });
    this.cullLayout = dev.createBindGroupLayout({
      label: 'tree-cull',
      entries: [buffer(0, C, 'uniform'), buffer(1, C, 'read-only-storage'), buffer(2, C, 'read-only-storage'), buffer(3, C, 'storage'), buffer(4, C, 'storage')],
    });
    this.finalizeLayout = dev.createBindGroupLayout({
      label: 'tree-finalize',
      entries: [buffer(0, C, 'uniform'), buffer(1, C, 'read-only-storage'), buffer(2, C, 'storage')],
    });

    const layout = (l: GPUBindGroupLayout): GPUPipelineLayout => dev.createPipelineLayout({ bindGroupLayouts: [rc.frame.layout, rc.world.layout, l] });
    const cull = rc.module('vegetation/tree_cull.wgsl');
    const fin = rc.module('vegetation/tree_finalize.wgsl');
    const cullPending = dev.createComputePipelineAsync({ label: 'tree-cull', layout: layout(this.cullLayout), compute: { module: cull, entryPoint: 'cull' } });
    const finalizePending = dev.createComputePipelineAsync({ label: 'tree-finalize', layout: layout(this.finalizeLayout), compute: { module: fin, entryPoint: 'finalize' } });
    const draw = (label: string, file: string, constants?: Record<string, number>): Promise<GPURenderPipeline> => {
      const module = rc.module(file);
      return dev.createRenderPipelineAsync({
        label,
        layout: layout(this.drawLayout),
        vertex: { module, entryPoint: 'vs', buffers: [VERTEX_LAYOUT], constants },
        fragment: { module, entryPoint: 'fs', targets: GBUFFER_TARGETS },
        primitive: { topology: 'triangle-list', cullMode: 'none' },
        depthStencil: DEPTH_STATE,
      });
    };
    this.ready = Promise.all([cullPending, finalizePending, draw('rock-draw', 'vegetation/rock.wgsl'), ...[0, 1, 2].map((lod) => draw(\`tree-draw-lod\${lod}\`, 'vegetation/tree.wgsl', { LOD: lod }))])
      .then(([cullPipe, finalizePipe, rockPipe, ...treePipes]) => {
        this.cullPipe = cullPipe; this.finalizePipe = finalizePipe; this.rockPipe = rockPipe; this.treePipes = treePipes;
      });
  }

  /** True for draws that use the rock pipeline. */
  isRockDraw(k: number): boolean {
    return isRockVariant(Math.floor(k / LOD_COUNT));
  }

  destroy(): void {
    this.vertexBuffer.destroy();
    this.indexBuffer.destroy();
    this.atlas.destroy();
    this.atlasData.destroy();
    this.barkNoise.destroy();
    for (const t of this.barkTextures) t.destroy();
  }
}
`,Jx=`import type { Vec3 } from '../../contracts';
import { add, dot, mul, norm, sub } from './meshBuilder';
import type { Limb } from './treePlan';

export interface WoodAttachment { point: Vec3; tangent: Vec3; radius: number; distance: number; limb: Limb | null }

/** Attach foliage to the emitted woody centreline, including its retained LOD vertices. */
export function nearestWood(limbs: readonly Limb[], point: Vec3): WoodAttachment {
  let best: WoodAttachment = { point: [0, 0, 0], tangent: [0, 1, 0], radius: 0.002, distance: Infinity, limb: null };
  for (const limb of limbs) for (let i = 1; i < limb.pts.length; i++) {
    const a = limb.pts[i - 1], edge = sub(limb.pts[i], a), t = Math.max(0, Math.min(1, dot(sub(point, a), edge) / Math.max(dot(edge, edge), 1e-12)));
    const p = add(a, mul(edge, t)), distance = Math.hypot(...sub(point, p));
    if (distance < best.distance) best = { point: p, tangent: norm(edge), radius: limb.radii[i - 1] + (limb.radii[i] - limb.radii[i - 1]) * t, distance, limb };
  }
  return best;
}
`,Yx=`import type { Vec3 } from '../../contracts';
import type { Rng } from '../../world/track/rng';
import { add, cross, mul, norm } from './meshBuilder';
import { pointAt, tangentAt, type Limb } from './treePlan';

const TAU = Math.PI * 2;
const UP: Vec3 = [0, 1, 0];
const GOLDEN = 2.399963;
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** The end of a branch: a foliage cluster goes here. \`order\` is the branching order of the limb that ends in it, \`limb\` that limb. */
export interface Tip { p: Vec3; r: number; order: number; limb?: Limb }

/** How the branches of one order sprout from their parent. */
export interface Level {
  /** Children per parent branch. */
  count: number;
  /** Children start this far along the parent (0..1) and are spread to \`end\`. */
  start: number;
  end: number;
  /** Angle between child and parent tangent (rad). */
  angle: [number, number];
  /** Child length as a fraction of the parent's length. */
  length: [number, number];
  segs: number;
  /** Upward (+) or drooping (-) growth bias, in radians of turn over the child's length. */
  bend: number;
  wobble: number;
  /** Child base radius as a fraction of the parent's radius at the fork, and its tip radius (m). */
  radius: number;
  tipRadius: number;
}

/** Integrates a branch centreline: the direction is nudged by \`bend\` (a turn toward +up spread over the length; a function of progress 0..1 for arching limbs) and random wobble at every step. */
export function growPath(rng: Rng, base: Vec3, dir0: Vec3, length: number, segs: number, bend: number | ((s: number) => number), wobble: number): Vec3[] {
  const pts: Vec3[] = [base];
  let d = norm(dir0), p = base;
  for (let i = 1; i <= segs; i++) {
    const rd = norm([rng.range(-1, 1), rng.range(-1, 1), rng.range(-1, 1)]);
    const b = typeof bend === 'number' ? bend : bend(i / segs);
    d = norm(add(add(d, mul(UP, b / segs)), mul(rd, wobble / segs)));
    p = add(p, mul(d, length / segs));
    pts.push(p);
  }
  return pts;
}

export function taperRadii(r0: number, r1: number, n: number, power = 1): number[] {
  return Array.from({ length: n }, (_, i) => lerp(r0, r1, Math.pow(i / (n - 1), power)));
}

export function limbLength(l: Limb): number {
  let s = 0;
  for (let i = 1; i < l.pts.length; i++) s += Math.hypot(l.pts[i][0] - l.pts[i - 1][0], l.pts[i][1] - l.pts[i - 1][1], l.pts[i][2] - l.pts[i - 1][2]);
  return s;
}

function radiusAt(l: Limb, s: number): number {
  const f = Math.min(Math.max(s, 0), 1) * (l.radii.length - 1), i = Math.min(Math.floor(f), l.radii.length - 2);
  return lerp(l.radii[i], l.radii[i + 1], f - i);
}

export interface SproutOptions {
  /** levels[i] describes the children of a limb of order \`order0 + i\`. */
  levels: readonly Level[];
  order0: number;
  /** Cluster radius (m) by limb order; the end of every limb of order >= \`tipFrom\` becomes a foliage tip. */
  tipRadius: Readonly<Record<number, number>>;
  tipFrom: number;
  limbs: Limb[];
  tips: Tip[];
}

/**
 * Grows the branches below \`parent\` recursively, level by level, with children spiralling around the parent at the golden angle.
 * Every limb is appended to \`o.limbs\`; the end of every limb of order >= \`o.tipFrom\` is appended to \`o.tips\`.
 */
export function sprout(rng: Rng, parent: Limb, o: SproutOptions): void {
  const lv = o.levels[parent.order - o.order0];
  if (parent.order >= o.tipFrom) o.tips.push({ p: parent.pts[parent.pts.length - 1], r: o.tipRadius[parent.order] ?? 0.5, order: parent.order, limb: parent });
  if (!lv) return;
  const len = limbLength(parent);
  const az0 = rng.range(0, TAU);
  for (let k = 0; k < lv.count; k++) {
    const s = lerp(lv.start, lv.end, (k + rng.range(0.15, 0.85)) / lv.count);
    const base = pointAt(parent.pts, s), tg = tangentAt(parent.pts, s);
    const ref: Vec3 = Math.abs(tg[1]) < 0.9 ? UP : [1, 0, 0];
    const p1 = norm(cross(tg, ref)), p2 = cross(tg, p1);
    const az = az0 + k * GOLDEN + rng.range(-0.35, 0.35), el = rng.range(lv.angle[0], lv.angle[1]);
    const perp = add(mul(p1, Math.cos(az)), mul(p2, Math.sin(az)));
    const dir = norm(add(mul(tg, Math.cos(el)), mul(perp, Math.sin(el))));
    const length = Math.max(0.25, len * rng.range(lv.length[0], lv.length[1]) * (1 - 0.35 * s));
    const pts = growPath(rng, base, dir, length, lv.segs, lv.bend, lv.wobble);
    // A visibility floor must never make a child thicker than the parent tip it grows from.
    const radius = radiusAt(parent, s) * Math.min(lv.radius, 0.9), tipRadius = Math.min(lv.tipRadius, radius * 0.8);
    const limb: Limb = { pts, radii: taperRadii(radius, tipRadius, pts.length, 0.85), order: parent.order + 1, parent };
    o.limbs.push(limb);
    sprout(rng, limb, o);
  }
}

/** Whether \`limb\` is \`root\` or grows from it. */
function descends(limb: Limb | undefined, root: Limb): boolean {
  for (let l = limb; l; l = l.parent) if (l === root) return true;
  return false;
}

/**
 * Kills a limb and everything that grows from it, as on an old or crowded tree: it keeps its wood (grey and bare in the shader), loses its
 * finer twigs (orders above \`keepOrder\`) and every leaf tip, and when \`broken\` is below 1 it has snapped off at that fraction of its length,
 * taking whatever grew beyond the break with it.
 */
export function killLimb(limbs: Limb[], tips: Tip[], limb: Limb, keepOrder: number, broken = 1): void {
  const gone = new Set<Limb>();
  if (broken < 1) {
    const n = Math.max(2, Math.round(limb.pts.length * broken));
    limb.pts.length = n; limb.radii.length = n;
    // The snapped end is ragged and narrower than the wood below it.
    limb.radii[n - 1] *= 0.45;
    for (const l of limbs) if (l.parent === limb && nearestIndex(limb, l.pts[0]) >= n - 1) gone.add(l);
  }
  for (let i = limbs.length - 1; i >= 0; i--) {
    const l = limbs[i];
    if (!descends(l, limb)) continue;
    let fallen = false;
    for (const g of gone) if (descends(l, g)) fallen = true;
    if (fallen || (l.order > keepOrder && l !== limb)) { gone.add(l); limbs.splice(i, 1); }
    else l.dead = true;
  }
  for (let i = tips.length - 1; i >= 0; i--) if (descends(tips[i].limb, limb)) tips.splice(i, 1);
}

/** Index of the point of \`limb\` nearest \`p\`. */
function nearestIndex(limb: Limb, p: Vec3): number {
  let best = 0, bestD = Infinity;
  limb.pts.forEach((q, i) => { const d = Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]); if (d < bestD) { bestD = d; best = i; } });
  return best;
}

`,Xx=`/// <reference lib="webworker" />
import { packAssets } from './treePack';
import { treeAsset } from './variants';

/** Builds the tree variants it is given (treeBuildPool.ts) and posts them back packed, their buffers transferred. */
self.onmessage = (e: MessageEvent<{ dense: boolean; variants: number[] }>) => {
  const { dense, variants } = e.data;
  const buffer = packAssets(variants.map((v) => treeAsset(v, dense)));
  (self as unknown as DedicatedWorkerGlobalScope).postMessage({ variants, buffer }, [buffer]);
};
`,Zx=`import { unpackAssets } from './treePack';
import { VARIANT_DEFS, type VariantAsset } from './variants';

/**
 * Builds the tree variants on worker threads, one share per worker, so a start (the extreme tier's crowns take a few minutes of CPU) runs on
 * every core and the page stays responsive. Returns the trees by variant index (null for rocks, which the caller builds), or null where
 * there are no workers (the offline Node tools), in which case the caller builds everything itself. \`only\` limits it to those tree
 * variants (the ones the disk cache did not have); the others come back null.
 */
export async function buildTreesInWorkers(dense: boolean, only?: readonly number[]): Promise<(VariantAsset | null)[] | null> {
  if (typeof Worker === 'undefined' || typeof navigator === 'undefined') return null;
  const trees = VARIANT_DEFS.map((d, v) => (d.rock < 0 && (!only || only.includes(v)) ? v : -1)).filter((v) => v >= 0);
  const count = Math.max(1, Math.min(trees.length, (navigator.hardwareConcurrency || 4) - 1));
  // One variant per worker where there are cores enough, else dealt round-robin, so each gets a mix of heavy (oak, birch, beech) and light ones.
  const shares: number[][] = Array.from({ length: count }, () => []);
  trees.forEach((v, i) => shares[i % count].push(v));
  const out: (VariantAsset | null)[] = VARIANT_DEFS.map(() => null);
  try {
    await Promise.all(shares.map((variants) => new Promise<void>((resolve, reject) => {
      const worker = new Worker(new URL('./treeBuild.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (e: MessageEvent<{ variants: number[]; buffer: ArrayBuffer }>) => {
        const assets = unpackAssets(e.data.buffer, e.data.variants.map((v) => VARIANT_DEFS[v]));
        worker.terminate();
        if (!assets) { reject(new Error('tree build worker returned a malformed buffer')); return; }
        e.data.variants.forEach((v, i) => { out[v] = assets[i]; });
        resolve();
      };
      worker.onerror = (e) => { worker.terminate(); reject(e); };
      worker.postMessage({ dense, variants });
    })));
  } catch {
    // A worker that fails (a blocked script, an old browser) only costs the build its speed: the caller builds on the main thread.
    return null;
  }
  return out;
}
`,Qx=`import type { Vec3 } from '../../contracts';
import { Rng, deriveSeed } from '../../world/track/rng';
import { FoliageSpace, type Piece } from './foliageSpace';
import { TILE, sheetFor, shootLayout, sprayLayout, tileOpacity, tileRect } from './leafAtlas';
import { KIND, MeshBuilder, add, anchoredCard, card, cross, len, mul, norm, sub, tube, type CardOptions, type MeshData } from './meshBuilder';
import { smoothstep } from './noise';
import { randomDir, rotAxis, trunkAt, trunkRadiusAt, type Cluster, type Frond, type Limb, type TreePlan } from './treePlan';
import { nearestWood } from './treeAttachments';
import type { SprayLayout } from './treeNeedleShapes';
import { SHEET, SHEET_BASE_V, SHEET_HALF_W, SHEET_STALK_V, SHEET_TIP_V, type ShootLayout } from './treeLeafShapes';

const TAU = Math.PI * 2;
const UP: Vec3 = [0, 1, 0];
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
/** Face directions of a regular tetrahedron. */
const TETRAHEDRON: Vec3[] = ([[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]] as Vec3[]).map(norm);
/** Half-size of a mid-distance leaf card as a multiple of its cluster radius; four of them cover about what two crossed cards and a flat one did. */
const CLUSTER_CARD = 0.95;

/**
 * Foliage options of a mesh build. \`dense\` is the extreme tier's crown: about twice the leaf cards and shoots at LOD0, six cluster cards instead
 * of four at LOD1, and a second needle curtain under every conifer frond. It adds cards only, on the same branches: the plan, the bounds the
 * cull uses and everything placement and colliders read are unchanged.
 */
export interface FoliageOptions {
  dense?: boolean;
  /** Called with the near LOD's foliage space once it is built (tests count the leaves that still cross). */
  report?: (space: FoliageSpace) => void;
  /** Receives every foliage piece the near LOD drew (leaves, cards and ribbons as emitted, without the cards that only stood in for a shoot). */
  pieces?: (all: Piece[]) => void;
}

/** Optional geometry audit of the exact near-LOD skeleton and every painted foliage attachment. */
/** Each foliage piece's attachment; \`span\` is its vertex count, the last vertex being the stationary one on the wood (5, an anchored card, when absent). */
export interface TreeContactAudit { wood: Limb[]; foliage: { point: Vec3; limb: Limb; span?: number }[] }

/** Lighting proxies baked into vertices: crown-shaped normals, interior occlusion and the height-based sway weight. */
interface Shading {
  normalAt: (p: Vec3) => Vec3;
  aoAt: (p: Vec3) => number;
  swayAt: (y: number) => number;
}

/**
 * How much foliage shades a point from the sky: the leaf clusters and sprays of the crown that lie above it, inside a cone opening upward,
 * each counted by its area and less the farther it is. A shoot deep under a heavy crown is in dense shade, one on the sunlit top in none;
 * the result multiplies the crown's ambient occlusion, so a crown reads as a layered, self-shadowed mass rather than evenly lit tufts.
 */
function foliageShade(plan: TreePlan): (p: Vec3) => number {
  const masses: [number, number, number, number][] = [
    ...plan.clusters.map((c): [number, number, number, number] => [c.c[0], c.c[1], c.c[2], c.r * c.r]),
    ...plan.fronds.map((f): [number, number, number, number] => [f.c[0], f.c[1], f.c[2], 0.25 * f.len * f.width]),
  ];
  // The shade varies over metres, so it is worked out once per SHADE_CELL cube and shared by every vertex in it: the extreme tier's
  // per-leaf crowns and finely cut trunks have hundreds of thousands of vertices.
  const memo = new Map<number, number>();
  return (p) => {
    const ix = Math.round(p[0] / SHADE_CELL), iy = Math.round(p[1] / SHADE_CELL), iz = Math.round(p[2] / SHADE_CELL);
    const key = ((ix + 512) * 1024 + (iy + 512)) * 1024 + (iz + 512);
    const known = memo.get(key);
    if (known !== undefined) return known;
    const qx = ix * SHADE_CELL, qy = iy * SHADE_CELL, qz = iz * SHADE_CELL;
    let shade = 0;
    for (const [x, y, z, area] of masses) {
      const up = y - qy;
      if (up < 0.3) continue;
      const side = Math.hypot(x - qx, z - qz);
      if (side > 0.9 * up + 1) continue;
      shade += area / (1 + 0.15 * up * up);
    }
    const out = 1 / (1 + FOLIAGE_SHADE * shade);
    memo.set(key, out);
    return out;
  };
}

/** Strength of the self-shading of a crown (foliageShade): a shoot under about four leaf clusters' worth of crown gets half the sky. */
const FOLIAGE_SHADE = 0.3;
/** Share of the crown-scale occlusion (crown shell, height, foliage above) baked into vertex AO; see aoAt in shading(). */
export const CROWN_AO_SHARE = 0.3;
/** Size (m) of the cubes foliageShade works the shade out for. */
const SHADE_CELL = 0.25;

function shading(plan: TreePlan): Shading {
  const [cx, cy, cz] = plan.crownC, [rx, ry, rz] = plan.crownR;
  const conifer = plan.foliage === KIND.needle;
  const H = plan.height;
  const mass = foliageShade(plan);
  return {
    normalAt: conifer
      ? (p) => {
        const dx = p[0] - cx, dz = p[2] - cz, h = Math.hypot(dx, dz);
        return h > 1e-4 ? norm([dx / h, 0.6, dz / h]) : UP;
      }
      : (p) => {
        const g = norm([(p[0] - cx) / (rx * rx), (p[1] - cy) / (ry * ry), (p[2] - cz) / (rz * rz)]);
        return norm([g[0], g[1] + 0.25, g[2]]);
      },
    // Every tier traces diffuse GI against the crowns' canopy proxies, which already darkens the inside and underside of a crown; baking the
    // whole crown's occlusion as well would count it twice (shaded leaves came out about 30x darker than sunlit grass instead of 4-8x). The
    // bake keeps CROWN_AO_SHARE of the crown-scale terms, so it carries only the local, sub-cluster occlusion the proxies cannot see:
    // outer leaves stay near 1, the deep interior about 0.75.
    aoAt: (p) => 1 - CROWN_AO_SHARE * (1 - (0.38 + 0.62 * smoothstep(0.2, 1, Math.hypot((p[0] - cx) / rx, (p[1] - cy) / ry, (p[2] - cz) / rz))) * (0.7 + 0.3 * smoothstep(-0.9, 0.6, (p[1] - cy) / ry)) * mass(p)),
    swayAt: (y) => Math.min(Math.pow(Math.max(y, 0) / H, 1.6), 1),
  };
}

/** \`mirror\` flips the tile left to right, which doubles the shoots a crown shows for free (the painted stem is on the tile's centre line). */
function cardOptions(sh: Shading, tile: number, kind: number, phase: number, mirror = false): CardOptions {
  const [u0, v0, u1, v1] = tileRect(tile);
  return { rect: mirror ? [u1, v0, u0, v1] : [u0, v0, u1, v1], kind, normalAt: sh.normalAt, aoAt: sh.aoAt, swayAt: (p) => sh.swayAt(p[1]), phase };
}

/** Leaf tile of a broadleaf shoot card: each species alternates between its two painted shoots (a bush between hazel and hawthorn). */
function shootTile(plan: TreePlan, rng: Rng): number {
  const second = rng.next() < 0.5;
  if (plan.species === 'bush') return second ? TILE.hawthorn : TILE.shrub;
  if (plan.species === 'birch') return second ? TILE.birch2 : TILE.birch;
  if (plan.species === 'beech') return second ? TILE.beech2 : TILE.beech;
  return second ? TILE.oak2 : TILE.sprig;
}

// Bark relief geometry at the extreme tier: limbs at least this thick (m at scale 1) are cut into rings and sides about RELIEF_STEP apart
// (at most RELIEF_MAX_SIDES round), so the displaced plates and furrows of the bark are a few vertices across.
const RELIEF_MIN_RADIUS = 0.15;
const RELIEF_STEP = 0.045;
const RELIEF_MAX_SIDES = 128;
// Only the wood within this height (m at scale 1) is cut finely: above it the relief is too far from a camera on the ground to show.
const RELIEF_MAX_HEIGHT = 9;

/** The limb with extra points on straight lines between its own, so no segment below \`maxY\` is longer than \`step\` metres. */
function subdivide(l: Limb, step: number, maxY: number): Limb {
  const pts: Vec3[] = [l.pts[0]], radii: number[] = [l.radii[0]];
  for (let i = 1; i < l.pts.length; i++) {
    const a = l.pts[i - 1], c = l.pts[i], n = Math.min(a[1], c[1]) < maxY ? Math.max(1, Math.ceil(len(sub(c, a)) / step)) : 1;
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      pts.push([a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t, a[2] + (c[2] - a[2]) * t]);
      radii.push(l.radii[i - 1] + (l.radii[i] - l.radii[i - 1]) * t);
    }
  }
  return { pts, radii, order: l.order };
}

function decimate(l: Limb, stride: number): Limb {
  if (stride === 1) return l;
  const n = l.pts.length, pts: Vec3[] = [], radii: number[] = [];
  for (let i = 0; i < n; i += stride) { pts.push(l.pts[i]); radii.push(l.radii[i]); }
  if ((n - 1) % stride !== 0) { pts.push(l.pts[n - 1]); radii.push(l.radii[n - 1]); }
  return { pts, radii, order: l.order };
}

/** Bark ring count of a branch by its base radius (m) at LOD0: limbs get round cross-sections, thin twigs triangles. */
const sidesFor = (radius: number): number => (radius > 0.06 ? 6 : radius > 0.035 ? 5 : radius > 0.018 ? 4 : 3);

/** Bark tubes: full detail at LOD0; at LOD1 only the trunk and (for small plans) the primary limbs, with few sides. */
function emitLimbs(b: MeshBuilder, plan: TreePlan, sh: Shading, lod: 0 | 1, dense = false): Limb[] {
  const many = plan.limbs.length > 100 && plan.foliage !== KIND.leaf;
  const parents = new Set(plan.limbs.map(limb => limb.parent)), emitted: Limb[] = [];
  plan.limbs.forEach((limb, index) => {
    let sides = plan.trunkSides[lod], stride = 1;
    if (limb.order > 0) {
      // LOD1 keeps the trunk and the living primary limbs; surface roots and dead stubs are left to the root flare.
      if (lod === 1 && (limb.order > 1 || many || limb.root || limb.dead)) return;
      // A thick surface root lies at eye level next to a drone flying low between the trunks: on five sides it reads as a faceted wedge.
      sides = lod === 0 ? (limb.root && limb.radii[0] > 0.06 ? 8 : Math.min(sidesFor(limb.radii[0]), many && limb.order > 1 ? 4 : limb.root ? 5 : 6)) : 3;
      stride = lod === 1 || !parents.has(limb) && (limb.order >= 3 || (many && limb.order === 1)) ? 2 : 1;
    }
    const d = decimate(limb, stride);
    // Leaves attach to living wood only.
    if (!limb.dead) emitted.push(d);
    const trunk = limb.order === 0, gnarl = plan.gnarl ?? 0;
    // At the extreme tier's near LOD a trunk or heavy limb is cut finely enough for the shader to push its bark relief out of the surface
    // (barkDisplacement in tree_bark.wgsl), so plates and furrows have real depth and break the outline.
    const relief = dense && lod === 0 && !limb.root && (trunk || limb.radii[0] > RELIEF_MIN_RADIUS) && limb.pts[0][1] < RELIEF_MAX_HEIGHT;
    const drawn = relief ? subdivide(d, RELIEF_STEP, RELIEF_MAX_HEIGHT) : d;
    if (relief) sides = Math.max(sides, Math.min(RELIEF_MAX_SIDES, Math.round((TAU * Math.max(...d.radii) * (trunk && plan.flare ? 1 + plan.flare.amp : 1)) / RELIEF_STEP)));
    // Bark offsets and swellings come from the limb's index, so both LODs build the same shape and pattern.
    tube(b, drawn.pts, drawn.radii, {
      // Planned radii are authoritative at forks and at the shoot attachments near branch tips.
      sides, kind: limb.dead ? KIND.deadWood : plan.bark, sway: (y) => sh.swayAt(y), ao: sh.aoAt, v0: (index * 7.31) % 20,
      buttress: trunk ? plan.flare : undefined,
      gnarl: gnarl > 0 && (trunk || limb.radii[0] > 0.08) ? { amp: gnarl * (trunk ? 1 : 0.6), seed: (index * 0.618034 + 0.13) % 1 } : undefined,
    });
  });
  return emitted;
}

/** Conifer sprays: two cards crossed along the branch axis; LOD1 keeps every third (or second) one, enlarged. */
function emitFronds(b: MeshBuilder, rng: Rng, plan: TreePlan, sh: Shading, lod: 0 | 1, wood: Limb[], audit?: TreeContactAudit, dense = false): void {
  const n = plan.fronds.length;
  const stride = lod === 0 ? 1 : n > 60 ? 3 : 2;
  const grow = lod === 0 ? 1 : stride === 3 ? 1.9 : 1.4;
  for (let i = 0; i < n; i++) {
    if (stride > 1 && i % stride !== 1 && !(n > 60 && i >= n - 4)) continue;
    const f = plan.fronds[i];
    const lat = norm(cross(f.t, Math.abs(f.t[1]) < 0.95 ? UP : [1, 0, 0]));
    const sprayTile = rng.next() < 0.5 ? TILE.needles2 : TILE.needles;
    const o = cardOptions(sh, sprayTile, KIND.needle, rng.next());
    // At the extreme tier's near LOD a spruce spray is built shoot by shoot (sprayShoots) instead of as two crossed flat cards.
    const realSpray = dense && lod === 0 && plan.species === 'spruce' && shellDepth(plan, f.c) > SPRAY_SHELL;
    if (realSpray) {
      // Placed in the tree as its flat card, keeping room for the drooping shoots either side of it, then built shoot by shoot in that pose.
      const up = mul(f.t, f.len * 0.5), anchor = nearestWood(wood, sub(f.c, mul(up, 0.94))), right = mul(lat, f.width * 0.5);
      const proxy = cardPiece(anchor.point, right, up, 0.97, o, sprayTile);
      proxy.spread = SPRAY_SPREAD * f.len;
      const placed = fit(proxy, poses(anchor.point, [f.t, lat], 0.2, UP, 0.04));
      if (placed) {
        const frame = newPiece(o, sprayTile);
        for (const p of [anchor.point, add(anchor.point, right), add(anchor.point, up)]) pushVertex(frame, p, UP, 0, 0, 0, 0);
        const [a0, r0, u0] = placed.move(frame).pos;
        standIn = placed.piece;
        sprayShoots(b, rng, sh, o, a0, sub(r0, a0), sub(u0, a0), sprayLayout(sprayTile), plan.bark);
      }
    }
    // A juniper's fronds stand round its centre like the pages of an open book: one card each, upright through the frond, so neighbouring
    // fronds meet only near the centre line instead of crossing one another.
    const juniper = plan.species === 'juniper', pair = nextGroup++;
    // At the near LOD a spray is three short shoots along its branch, each cut from its third of the spray tile and tilted alternately
    // either way about the branch, so the spray has depth, and each small enough to follow the wind as a whole branch would (a metre-wide
    // card bends away from it far enough to cut through its neighbours). INNER_SHOOTS more, cut like the first, carry the spray on along
    // the branch toward the trunk, where a spruce's branches are clothed too.
    if (lod === 0 && !realSpray && !juniper) {
      const up = mul(f.t, f.len * 0.5), [u0, v0, u1, v1] = o.rect;
      for (let k = -INNER_SHOOTS; k < FROND_SHOOTS; k++) {
        const y0 = -0.84 + (1.84 * k) / FROND_SHOOTS, part = mul(up, 1 / FROND_SHOOTS), y1 = -0.84 + (1.84 * (Math.max(k, 0) + 1)) / FROND_SHOOTS;
        // Fractions of the card from its top; the top shoot's rounds to just past 1, which would put its v off the tile.
        const vTop = v0 + (v1 - v0) * 0.92 * Math.max(0, 1 - (y1 + 0.84) / 1.84), vBot = v0 + (v1 - v0) * 0.92 * Math.min(1, 1 - (y1 - 1.84 / FROND_SHOOTS + 0.84) / 1.84);
        const anchor = nearestWood(wood, add(f.c, mul(up, y0))), um = (u0 + u1) / 2;
        // Each shoot is cut again down the branch: its side shoots on either side are a half card each, drooping outward from the branch
        // in a shallow V as a spruce spray does, narrow enough to settle among its neighbours and follow the wind.
        for (const h of [1, -1]) {
          const so = { ...o, rect: [h > 0 ? um : u0, vTop, h > 0 ? u1 : um, vTop + (vBot - vTop) / 0.92] as [number, number, number, number] };
          const right = mul(rotAxis(lat, f.t, h * SPRAY_DROOP + (k % 2 === 0 ? 0.15 : -0.15)), f.width * 0.4);
          const piece = cardPiece(anchor.point, right, part, 0.97, so, sprayTile, pair), last = piece.pos.length - 1;
          for (let i = 0; i < last; i++) piece.pos[i] = add(piece.pos[i], mul(right, h));
          const placed = settle(b, piece, anchor.point, [f.t, lat], 0.2, UP, 0.04);
          if (placed) audit?.foliage.push(attached(placed, anchor.limb!));
        }
      }
    }
    for (const s of realSpray || (lod === 0 && !juniper) ? [] : juniper ? [0] : [1, -1]) {
      const right = mul(juniper ? norm(cross(lat, f.t)) : rotAxis(lat, f.t, s * 0.6), f.width * (juniper ? 0.45 : 0.5) * grow), up = mul(f.t, f.len * 0.5 * grow);
      if (lod === 0) {
        const anchor = nearestWood(wood, sub(f.c, mul(up, 0.94)));
        // A juniper page is a grid of two rows, so it bends with the wind as a whole frond would, and it starts a quarter of the frond out
        // from the centre, where the pages crowd together, on a bare stalk from the wood. JUNIPER_PAGE_LENGTH keeps the page, once moved out
        // off the centre line, inside the footprint the park reserves for the frond (src/world/park/planting.ts plantingBounds).
        const piece = juniper ? shapedCard(add(anchor.point, mul(up, 0.5)), mul(right, 1.2), mul(up, JUNIPER_PAGE_LENGTH), 0.97, o, FLAT, 2, sprayTile) : cardPiece(anchor.point, right, up, 0.97, o, sprayTile, pair);
        if (juniper) {
          // A steep frond's page reaches past the centre line with its inner edge, where it would cut through every page on the far side: it
          // moves straight out until that edge stands JUNIPER_AXIS_ROOM off the line.
          const out = norm([f.t[0], 0, f.t[2]]), last = piece.pos.length - 1;
          let inner = Infinity;
          for (let i = 0; i < last; i++) inner = Math.min(inner, dot3(piece.pos[i], out));
          const d = mul(out, Math.max(0, JUNIPER_AXIS_ROOM - inner));
          for (let i = 0; i < last; i++) piece.pos[i] = add(piece.pos[i], d);
          piece.pos[last] = anchor.point;
          juniperShoots(piece, o, sprayTile);
        }
        const placed = settle(b, piece, anchor.point, [f.t, lat], 0.2, UP, 0.04);
        if (placed) audit?.foliage.push(attached(placed, anchor.limb!));
      }
      else card(b, f.c, right, up, o);
    }
    if (plan.species === 'spruce') {
      // A Norway spruce's upturned branches carry a curtain of drooping branchlets, each a bottle-brush of needles all round: curved, crossed
      // ribbons hang from points along the branch and fill the crown with needles in depth: one per branch within budget, six (and two at the
      // far LOD) at the extreme tier.
      const count = lod === 0 ? (dense ? (realSpray ? 5 : 6) : 1) : dense ? 2 : 0;
      for (let k = 0; k < count; k++) branchlet(b, rng, sh, f, lat, (k + rng.range(0.15, 0.85)) / count, k % 2 === 0 ? 1 : -1, lod === 0 && dense, grow, dense ? 4 : 3, lod === 0 ? wood : [], audit);
    }
    if (lod !== 0) continue;
    // Other conifers' side shoots hang from the branch in a curtain under the flat spray: cards pointing down and out from the branch fill the
    // crown with needles in depth instead of one flat layer per branch.
    for (let k = 0; k < (plan.species === 'spruce' || juniper ? 0 : dense ? 2 : 1); k++) {
      const at = sub(f.c, mul(f.t, f.len * rng.range(0.05, 0.3)));
      const hang = norm(add(mul(f.t, rng.range(0.25, 0.6)), [0, -1, 0]));
      const across = norm(cross(hang, lat));
      const right = mul(norm(add(lat, mul(across, rng.range(-0.4, 0.4)))), f.width * rng.range(0.28, 0.36)), down = mul(hang, f.len * rng.range(0.24, 0.34));
      const anchor = nearestWood(wood, at);
      const placed = settle(b, cardPiece(anchor.point, right, down, 0.97, cardOptions(sh, TILE.needles, KIND.needle, rng.next(), rng.next() < 0.5), TILE.needles), anchor.point, [hang], 0.3);
      if (placed) audit?.foliage.push(attached(placed, anchor.limb!));
    }
    if (dense && !realSpray) {
      const anchor = nearestWood(wood, sub(f.c, mul(f.t, f.len * 0.47)));
      const placed = settle(b, cardPiece(anchor.point, mul(lat, f.width * 0.45), mul(f.t, f.len * 0.48), 0.97, cardOptions(sh, TILE.needles, KIND.needle, rng.next(), true), TILE.needles, pair), anchor.point, [f.t], 0.25);
      if (placed) audit?.foliage.push(attached(placed, anchor.limb!));
    }
  }
}

/**
 * A strip along \`pts\` (base first, on the wood) of half-width \`side[i]\` at each point, textured from the tile's painted base (v = 0.97) to its
 * top, closed by a stationary root vertex at the base so wind cannot tear it off the branch. Returns its vertex count.
 */
function ribbon(pts: readonly Vec3[], side: readonly Vec3[], o: CardOptions, tile: number, group: number): FPiece {
  const [u0, v0, u1, v1] = o.rect, n = pts.length, piece = newPiece(o, tile, group);
  for (let i = 0; i < n; i++) {
    const f = i / (n - 1), v = lerp(v0 + (v1 - v0) * 0.97, v0 + (v1 - v0) * 0.02, f);
    for (const [s, u] of [[-1, u0], [1, u1]] as const) {
      const p = add(pts[i], mul(side[i], s));
      // Flutter grows from nothing where the branchlet leaves the branch to full at its tip.
      pushVertex(piece, p, o.normalAt(p), u, v, o.aoAt(p), o.swayAt(p) * f);
    }
  }
  for (let i = 0; i < n - 1; i++) { const a = 2 * i; piece.tris.push([a, a + 1, a + 3], [a, a + 3, a + 2]); }
  const root = pushVertex(piece, pts[0], o.normalAt(pts[0]), (u0 + u1) / 2, v0 + (v1 - v0) * 0.97, o.aoAt(pts[0]), 0);
  piece.tris.push([root, 0, 1]);
  return piece;
}

/**
 * One drooping spruce branchlet hanging from fraction \`along\` of frond \`f\`, on flank \`flank\`: a path that leaves the branch down and out and
 * bends further down under its own weight, dressed in a bottle-brush ribbon; at the extreme tier's full detail two crossed ones, so it reads round from any side.
 */
function branchlet(b: MeshBuilder, rng: Rng, sh: Shading, f: Frond, lat: Vec3, along: number, flank: number, crossed: boolean, grow: number, segments: number, wood: Limb[], audit?: TreeContactAudit): void {
  const len = f.len * grow * rng.range(0.6, 0.9) * (1 - 0.3 * along), half = len * rng.range(0.17, 0.22);
  // It hangs from the nearest real wood to its point along the branch (the near LOD's branch tubes; the far LOD has no fine wood to hold it).
  const at = add(add(f.c, mul(f.t, f.len * grow * (along - 0.5) * 0.9)), mul(lat, flank * f.width * grow * 0.08));
  const anchor = wood.length ? nearestWood(wood, at) : null;
  let p = anchor ? anchor.point : at;
  let d = norm(add(add(mul(lat, flank * rng.range(0.3, 0.7)), mul(f.t, rng.range(0.2, 0.45))), [0, -rng.range(0.5, 0.9), 0]));
  const pts: Vec3[] = [p], dirs: Vec3[] = [d];
  for (let i = 0; i < segments; i++) {
    p = add(p, mul(d, len / segments));
    d = norm(add(d, [0, -0.35, 0]));
    pts.push(p); dirs.push(d);
  }
  const tile = rng.next() < 0.5 ? TILE.brush : TILE.brush2, o = cardOptions(sh, tile, KIND.needle, rng.next(), rng.next() < 0.5);
  const turn = rng.range(0, Math.PI), group = nextGroup++;
  for (const r of crossed ? [turn, turn + Math.PI / 2] : [turn]) {
    // A branchlet that would hang through its neighbours swings about its point of attachment.
    const placed = settle(b, ribbon(pts, dirs.map((t) => mul(rotAxis(norm(cross(t, lat)), t, r), half)), o, tile, group), pts[0], [UP, lat], 0.3, lat, 0.04);
    if (anchor && placed) audit?.foliage.push(attached(placed, anchor.limb!));
  }
}

/**
 * A spruce spray as real shoots: the spray tile's leader as a thin tube and each of its side shoots as two crossed bottle-brush ribbons
 * (the brush tiles, which paint a side shoot with its secondary shoots), at the painted shoot's place in the spray, drooping under its own
 * weight toward the tip. From any side the spray has depth and gaps instead of one flat sheet of needles. \`right\` and \`up\` are the half
 * extents of the flat card the spray replaces, \`anchor\` its base on the branch.
 */
function sprayShoots(b: MeshBuilder, rng: Rng, sh: Shading, o: CardOptions, anchor: Vec3, right: Vec3, up: Vec3, layout: SprayLayout, bark: number): void {
  const center = add(anchor, mul(up, 0.94)), face = norm(cross(right, up)), h = len3(right);
  const at = (tu: number, tv: number): Vec3 => add(center, add(mul(right, (tu - 0.5) * 2), mul(up, 1 - 2 * tv)));
  const lead = [0, 5, 10, layout.leader.length - 1].map((i) => at(...layout.leader[i]));
  tube(b, lead, [0.006 * h * 2, 0.005 * h * 2, 0.004 * h * 2, 0.0025 * h * 2], { sides: 3, kind: bark, sway: (y) => sh.swayAt(y), ao: (p) => o.aoAt(p) });
  // The spray was placed in the tree as a whole (emitFronds); its shoots only have to keep out of each other's way.
  const shared = space;
  if (shared) { space = new FoliageSpace(); treeSpace = shared; }
  for (const sh2 of layout.shoots) {
    const a = at(sh2.ax, sh2.ay), e = at(sh2.bx, sh2.by), length = len3(sub(e, a)), sag = length * rng.range(0.15, 0.4);
    const pts: Vec3[] = [a, add(add(a, mul(sub(e, a), 0.5)), [0, -0.35 * sag, 0]), add(e, [0, -sag, 0])];
    const dirs = pts.map((_, i) => norm(sub(pts[Math.min(i + 1, 2)], pts[Math.max(i - 1, 0)])));
    const tile = rng.next() < 0.5 ? TILE.brush : TILE.brush2, ro = cardOptions(sh, tile, KIND.needle, rng.next(), rng.next() < 0.5);
    const half = length * rng.range(0.5, 0.6), turn = rng.range(-0.3, 0.3), group = nextGroup++;
    for (const r of [turn + 0.6, turn - 0.6]) settle(b, ribbon(pts, dirs.map((t) => mul(rotAxis(norm(cross(t, face)), t, r), half)), ro, tile, group), a, [face, dirs[0]], 0.25);
  }
  space = shared;
  treeSpace = standIn = null;
}

/** A far-LOD pine branch end: a card of the branch-end tile whose base sits at the cluster centre and whose tip points along a random direction. */
function tuft(b: MeshBuilder, rng: Rng, sh: Shading, cl: Cluster, halfLen: number): void {
  const d = randomDir(rng), side = norm(cross(d, randomDir(rng)));
  card(b, add(cl.c, mul(d, halfLen * 0.85)), mul(side, halfLen * 0.55), mul(d, halfLen), cardOptions(sh, TILE.pine, KIND.needle, rng.next(), rng.next() < 0.5));
}

/**
 * A Scots pine's branch end at the near LOD: \`count\` shoots, each a foxtail of needles (the single-shoot pine2 tile) on a straight ribbon
 * that leaves the wood near the cluster out and up, as pine shoots grow; two crossed ribbons each at the extreme tier, so a shoot reads round
 * from any side. The ribbons lie in near-level layers (twisted at most PINE_SHOOT_TWIST about their axis), as a branch end's shoots fan out:
 * twisted at random, neighbours met at steep angles and the wind's bending field pushed them through each other. Under a metre long, they
 * follow that field closely; the two-metre tuft cards these replace bent away from it and cut through their neighbours.
 */
function pineShoots(b: MeshBuilder, rng: Rng, sh: Shading, cl: Cluster, count: number, crossed: boolean, wood: Limb[], audit?: TreeContactAudit): void {
  for (let i = 0; i < count; i++) {
    const target = add(cl.c, mul(randomDir(rng), cl.r * rng.range(0.2, 0.7))), anchor = nearestWood(wood, target);
    const out = sub(target, anchor.point), d = norm(add(len3(out) > 1e-3 ? norm(out) : randomDir(rng), [0, 0.35, 0]));
    const length = Math.max(cl.r, PINE_SHOOT_SCALE_MIN) * rng.range(PINE_SHOOT_LENGTH[0], PINE_SHOOT_LENGTH[1]), d2 = norm(add(d, [0, 0.3, 0]));
    const tip = norm(add(d, d2)), pts: Vec3[] = [anchor.point, add(anchor.point, mul(tip, length))];
    const dirs = [tip, tip];
    // The painted shoot is as long as the tile is high and about as wide, so the ribbon keeps the tile's aspect.
    const half = length * 0.53, o = cardOptions(sh, TILE.pine2, KIND.needle, rng.next(), rng.next() < 0.5);
    const turn = rng.range(-PINE_SHOOT_TWIST, PINE_SHOOT_TWIST), group = nextGroup++;
    for (const r of crossed ? [turn, turn + Math.PI / 2] : [turn]) {
      const side = dirs.map((t) => mul(rotAxis(norm(cross(t, Math.abs(t[1]) < 0.95 ? UP : [1, 0, 0])), t, r), half));
      const placed = settle(b, ribbon(pts, side, o, TILE.pine2, group), anchor.point, [UP, d], 0.3, UP, 0.04);
      if (placed) audit?.foliage.push(attached(placed, anchor.limb!));
    }
  }
}

/** A pine shoot's length as a share of its cluster's radius (at least PINE_SHOOT_SCALE_MIN m: a small clump's shoots are still 35-55 cm
 * long, a real Scots pine shoot's length), how many shoots stand in for each of the plan's branch-end cards, and how far (rad) a shoot's
 * ribbon turns about its axis out of the level. */
const PINE_SHOOT_LENGTH = [0.5, 0.8] as const, PINE_SHOOTS_PER_CARD = 5, PINE_SHOOT_TWIST = 0.35, PINE_SHOOT_SCALE_MIN = 0.7;

/**
 * How far out in the crown a point is: 0 at its centre, 1 on the crown ellipsoid (plan crownC, crownR). Shoots beyond OUTER_SHELL count as
 * on the outside of the crown and are built leaf by leaf at the extreme tier (leafShoot); the rest, mostly hidden, stay cards.
 */
const shellDepth = (plan: TreePlan, p: Vec3): number =>
  Math.hypot((p[0] - plan.crownC[0]) / plan.crownR[0], (p[1] - plan.crownC[1]) / plan.crownR[1], (p[2] - plan.crownC[2]) / plan.crownR[2]);
const OUTER_SHELL = 0.95;

/** How a shoot card is bent out of its plane: tangent of the fold angle along the stem, tip curl and twist, all relative to the card's half size. */
interface CardShape { fold: number; curl: number; twist: number }
const FLAT: CardShape = { fold: 0, curl: 0, twist: 0 };

/**
 * A shoot card bent into a shallow 3D shape, anchored like anchoredCard (a stationary root vertex on the shoot, last). Real sprays are not
 * flat: the two sides rise from the stem in a V, the tip droops and the spray twists along its length. With \`rows\` 0 it keeps anchoredCard's
 * five vertices and three triangles, so the four corners lift into a cupped bowl around the root at no extra cost; with \`rows\` > 0 it is a
 * grid of three columns (the middle one on the painted stem) and that many rows above the base row, so the fold and the curl are real
 * creases. Vertex normals follow the bent surface, half blended with the crown normal so a crown still shades as a volume. Returns its
 * vertex count.
 */
function shapedCard(anchor: Vec3, right: Vec3, up: Vec3, stemV: number, o: CardOptions, s: CardShape, rows: number, tile: number): FPiece {
  const h = len3(up), face = norm(cross(right, up)), [u0, v0, u1, v1] = o.rect, piece = newPiece(o, tile);
  const center = add(anchor, mul(up, 2 * stemV - 1));
  // Height above the card plane (m) at card coordinates x (-1..1 across) and y (-0.84 at the base row .. 1 at the tip), and its normal.
  const lift = (x: number, y: number): number => { const t = (y + 0.84) / 1.84; return h * (s.fold * Math.abs(x) - s.curl * t * t + s.twist * x * t); };
  const point = (x: number, y: number): Vec3 => add(add(center, add(mul(right, x), mul(up, y))), mul(face, lift(x, y)));
  const normal = (x: number, y: number, p: Vec3): Vec3 => {
    const t = (y + 0.84) / 1.84;
    const dx = add(right, mul(face, h * (s.fold * Math.sign(x) + s.twist * t))), dy = add(up, mul(face, (h * (-2 * s.curl * t + s.twist * x)) / 1.84));
    const g = norm(cross(dx, dy)), c = o.normalAt(p);
    return norm(add(mul(c, 0.5), mul(dot3(g, c) < 0 ? mul(g, -1) : g, 0.5)));
  };
  const vert = (x: number, y: number): number => {
    const p = point(x, y), u = u0 + (u1 - u0) * (x + 1) / 2, v = v0 + (v1 - v0) * 0.92 * (1 - (y + 0.84) / 1.84);
    return pushVertex(piece, p, normal(x, y, p), u, v, o.aoAt(p), o.swayAt(p));
  };
  const rootVertex = (): number => pushVertex(piece, anchor, o.normalAt(anchor), (u0 + u1) / 2, v0 + (v1 - v0) * stemV, o.aoAt(anchor), 0);
  if (rows === 0) {
    const ids = [[1, -0.84], [1, 1], [-1, 1], [-1, -0.84]].map(([x, y]) => vert(x, y));
    const root = rootVertex();
    for (let i = 0; i < 3; i++) piece.tris.push([root, ids[i], ids[i + 1]]);
    return piece;
  }
  for (let j = 0; j <= rows; j++) for (const x of [-1, 0, 1]) vert(x, -0.84 + (1.84 * j) / rows);
  for (let j = 0; j < rows; j++) for (let i = 0; i < 2; i++) { const a = 3 * j + i; piece.tris.push([a, a + 1, a + 4], [a, a + 4, a + 3]); }
  const root = rootVertex();
  piece.tris.push([root, 1, 0], [root, 2, 1]);
  return piece;
}

/** A foliage piece as it is emitted: the clash-checked geometry plus the vertex attributes the mesh needs. */
interface FPiece extends Piece { nrm: Vec3[]; sway: number[]; ao: number[]; kind: number; phase: number }

/** Near-LOD foliage placed so far in the tree being built (null at the far LODs, where nothing is checked), and the next free group id. */
let space: FoliageSpace | null = null;
/** The near LOD's drawn foliage pieces, collected when FoliageOptions.pieces asks for them. */
let emitted: FPiece[] | null = null;
/** While a shoot is built in its own space (leafShoot, sprayShoots), the whole tree's: its pieces must fit there too. */
let treeSpace: FoliageSpace | null = null;
/** The card that holds that shoot's place in the tree's space (its own pieces may overlap it). */
let standIn: FPiece | null = null;
let nextGroup = 0;
/** Sway weight by height of the tree being built (Shading.swayAt), which a piece's weights follow when the clash pass moves it (resway). */
let heightSway: ((y: number) => number) | null = null;
/** Room the needle pieces of the plant being built keep (NEEDLE_ROOM, or BUSH_NEEDLE_ROOM for a juniper), set by buildTreeLods. */
let needleRoom = 0;
/** Phase (colour tone) of the twig being dressed: the leaves of one shoot are nearly the same shade, as on a real tree. */
let twigPhase = 0;

/**
 * Room (m) a leaf piece keeps from its neighbours, and how far (cells of a 128-cell tile mask) the check looks for paint around each of its
 * probes (about their spacing on a shoot card). Needle shoots look closer, being painted solid and crowded along their branches. A conifer
 * tree's needle shoots keep NEEDLE_ROOM: in a strong wind its tall crown bends a little differently from piece to piece: at 6 mm one pair in
 * a hundred to two hundred pieces brushed through each other, at 15 mm about one in two thousand. A juniper, whose low fronds hardly move, keeps BUSH_NEEDLE_ROOM.
 */
const LEAF_ROOM = 0.01, LEAF_NEAR = 4, NEEDLE_ROOM = 0.015, BUSH_NEEDLE_ROOM = 0.006, NEEDLE_NEAR = 2;
/** At the extreme tier: how far (m) a shoot built leaf by leaf spreads off its card's plane, and the room its leaves keep from each other. */
const SHOOT_SPREAD = 0.035, LEAF_LEAF_ROOM = 0.004;
/** Short shoots a conifer spray is built from at the near LOD (emitFronds). */
const FROND_SHOOTS = 2, INNER_SHOOTS = 1;
/** At the extreme tier, sprays this far out in the crown (shellDepth) are built shoot by shoot (sprayShoots); inside it, as half-shoots. */
const SPRAY_SHELL = 0.85;
/** How far (rad) the two halves of a near-LOD spray shoot droop from the branch's level either side. */
const SPRAY_DROOP = 1.15;
/** How far (m) a juniper's frond pages keep their inner edges off the shrub's centre line, and a page's height as a share of its frond's
 * half-length (emitFronds). */
const JUNIPER_AXIS_ROOM = 0.15, JUNIPER_PAGE_LENGTH = 0.72;
/** How far a spruce spray built shoot by shoot (sprayShoots) spreads off its card's plane, per metre of spray length. */
const SPRAY_SPREAD = 0.15;

function newPiece(o: CardOptions, tile: number, group = nextGroup++): FPiece {
  return { pos: [], nrm: [], uv: [], sway: [], tris: [], ao: [], kind: o.kind, phase: o.phase, opaque: tileOpacity(tile), group,
    ...(o.kind === KIND.needle ? { near: tileOpacity(tile, NEEDLE_NEAR), room: needleRoom } : { near: tileOpacity(tile, LEAF_NEAR), room: LEAF_ROOM }) };
}

function pushVertex(p: FPiece, pos: Vec3, n: Vec3, u: number, v: number, ao: number, sway: number): number {
  p.pos.push(pos); p.nrm.push(norm(n)); p.uv.push([u, v]); p.ao.push(ao); p.sway.push(sway);
  return p.pos.length - 1;
}

/** A copy of a piece turned by \`angle\` about the line through \`pivot\` along the unit \`axis\`. */
function turned(p: FPiece, pivot: Vec3, axis: Vec3, angle: number): FPiece {
  return { ...p, pos: p.pos.map((q) => add(pivot, rotAxis(sub(q, pivot), axis, angle))), nrm: p.nrm.map((n) => rotAxis(n, axis, angle)) };
}

/** A copy of a piece shrunk by \`s\` toward \`pivot\`. */
function scaled(p: FPiece, pivot: Vec3, s: number): FPiece {
  return { ...p, pos: p.pos.map((q) => add(pivot, mul(sub(q, pivot), s))) };
}

/** A copy of a piece moved by \`d\`, except where it is fixed on its wood at \`pivot\` (its stalk tilts up or down to follow). */
function shifted(p: FPiece, d: Vec3, pivot: Vec3): FPiece {
  return { ...p, pos: p.pos.map((q) => (q[0] === pivot[0] && q[1] === pivot[1] && q[2] === pivot[2] ? q : add(q, d))) };
}

/**
 * Emits a foliage piece where it crosses no other: at the near LOD it is tried as built, then turned about each of \`axes\` through \`pivot\`
 * by growing angles both ways, then shrunk, and the first pose that crosses nothing is kept (FoliageSpace). Returns its vertex count, 0 if
 * no pose fits and the piece is left out.
 */
function settle(b: MeshBuilder, base: FPiece, pivot: Vec3, axes: readonly Vec3[], step: number, lift?: Vec3, gap = 0.03, slide: readonly Vec3[] = []): FPiece | null {
  const f = fit(base, poses(pivot, axes, step, lift, gap, slide));
  if (f) emit(b, f.piece);
  return f?.piece ?? null;
}

/** A placed piece's attachment for the contact audit: its stationary root vertex (the last) on \`limb\`. */
const attached = (p: FPiece, limb: Limb): { point: Vec3; limb: Limb; span: number } => ({ point: p.pos[p.pos.length - 1], limb, span: p.pos.length });

/** Moves that slide a spray from fraction \`along\` of its straight twig to nearby points on it, by 3, 6 and 9 cm each way. */
function slides(shoot: Limb, along: number): Vec3[] {
  const d = sub(shoot.pts[1], shoot.pts[0]), length = len3(d), out: Vec3[] = [];
  for (const k of [1, -1, 2, -2, 3, -3]) {
    const f = along + (0.03 * k) / length;
    if (f > 0.05 && f < 1) out.push(mul(d, f - along));
  }
  return out;
}

/** The candidate poses settle tries, in order, as moves of a piece. */
function poses(pivot: Vec3, axes: readonly Vec3[], step: number, lift?: Vec3, gap = 0.03, slide: readonly Vec3[] = []): ((q: FPiece) => FPiece)[] {
  // Sliding the piece along its twig (when it can) and lifting it a little off its layer come first, then turning it, then the piece at three quarters
  // and about half its size, in the first few of those poses.
  const moves: ((q: FPiece) => FPiece)[] = slide.map((d) => (q: FPiece) => ({ ...q, pos: q.pos.map((v) => add(v, d)) }));
  if (lift) for (const d of [1, -1, 2, -2, 3, -3]) moves.push((q) => shifted(q, mul(lift, d * gap), pivot));
  for (const axis of axes) for (const d of [1, -1, 2, -2, 4, -4]) moves.push((q) => turned(q, pivot, axis, d * step));
  const smaller = [0.75, 0.55].flatMap((k) => {
    const shrink = (q: FPiece): FPiece => scaled(q, pivot, k);
    return [shrink, ...moves.slice(0, 6).map((f) => (q: FPiece) => f(shrink(q)))];
  });
  return [(q) => q, ...moves, ...smaller];
}

/** The first pose of \`base\` that crosses nothing, placed in the foliage space, with the move that made it; null if none fits. */
function fit(base: FPiece, moves: readonly ((q: FPiece) => FPiece)[]): { piece: FPiece; move: (q: FPiece) => FPiece } | null {
  if (!space) return { piece: base, move: moves[0] };
  let k = 0;
  const p = space.place((i) => (i < moves.length ? moves[(k = i)](base) : null), treeSpace ?? undefined, standIn ?? undefined) as FPiece | null;
  return p ? { piece: k === 0 ? p : resway(p, base), move: moves[k] } : null;
}

/**
 * A moved piece with its sway weights following its vertices to their new heights (they were set by height where it was built): a piece
 * turned down toward the ground sways as little as the foliage round it there, so the wind moves it with its neighbours.
 */
function resway(p: FPiece, base: FPiece): FPiece {
  if (!heightSway) return p;
  const w = heightSway;
  return { ...p, sway: p.sway.map((s, i) => { const before = w(base.pos[i][1]); return before > 1e-6 ? Math.min(1, (s * w(p.pos[i][1])) / before) : s; }) };
}

/** Adds a piece to the mesh; returns its vertex count. */
function emit(b: MeshBuilder, p: FPiece): number {
  emitted?.push(p);
  const phase = (p.phase % 1 + 1) % 1;
  const first = b.vertexCount;
  for (let i = 0; i < p.pos.length; i++) b.vertex({ p: p.pos[i], n: p.nrm[i], u: p.uv[i][0], v: p.uv[i][1], ao: p.ao[i], sway: p.sway[i], kind: p.kind, phase });
  for (const [i, j, k] of p.tris) b.tri(first + i, first + j, first + k);
  return p.pos.length;
}

/**
 * A juniper frond's side shoots: short cards rising out of either face of its page (a two-row shapedCard grid) from points along its stem,
 * so the shrub is a mass of needles in depth instead of a star of flat pages with air between them. They become part of the page piece,
 * ahead of its root vertex (which stays last, on the wood), and each shoot's foot moves with the wind as the page does where it grows from
 * (foliage sways by height), so the two stay joined.
 */
function juniperShoots(page: FPiece, o: CardOptions, tile: number): void {
  const base = page.pos[1], tip = page.pos[7], stem = sub(tip, base), length = len3(stem);
  const across = sub(page.pos[2], page.pos[0]), face = norm(cross(across, stem)), side = norm(across), width = len3(across);
  const root = page.pos.length - 1, keep = { pos: page.pos[root], nrm: page.nrm[root], uv: page.uv[root], ao: page.ao[root], sway: page.sway[root] };
  for (const key of ['pos', 'nrm', 'uv', 'ao', 'sway'] as const) page[key].pop();
  const rootTris = page.tris.filter((t) => t.includes(root)), tris = page.tris.filter((t) => !t.includes(root));
  for (const [along, s] of JUNIPER_SHOOTS) {
    const foot = add(base, mul(stem, along)), dir = norm(add(mul(norm(stem), Math.cos(JUNIPER_SHOOT_TILT)), mul(face, s * Math.sin(JUNIPER_SHOOT_TILT))));
    const shoot = cardPiece(foot, mul(side, width * 0.22), mul(dir, length * 0.22), 0.97, o, tile);
    shoot.sway[shoot.sway.length - 1] = o.swayAt(foot);
    const first = page.pos.length;
    for (let i = 0; i < shoot.pos.length; i++) pushVertex(page, shoot.pos[i], shoot.nrm[i], shoot.uv[i][0], shoot.uv[i][1], shoot.ao[i], shoot.sway[i]);
    for (const [i, j, k] of shoot.tris) tris.push([first + i, first + j, first + k]);
  }
  const last = page.pos.length;
  page.pos.push(keep.pos); page.nrm.push(keep.nrm); page.uv.push(keep.uv); page.ao.push(keep.ao); page.sway.push(keep.sway);
  for (const t of rootTris) tris.push(t.map((i) => (i === root ? last : i)) as [number, number, number]);
  page.tris = tris;
}

/** Where a juniper page's side shoots grow (fraction of its stem, and which face), and how far (rad) they lean out of it. */
const JUNIPER_SHOOTS: readonly [number, number][] = [[0.45, 1], [0.6, -1], [0.75, 1], [0.9, -1]];
const JUNIPER_SHOOT_TILT = 0.7;

/** anchoredCard (meshBuilder.ts) as a foliage piece: a flat card with a stationary root vertex at the painted stem base, last. */
function cardPiece(anchor: Vec3, right: Vec3, up: Vec3, stemV: number, o: CardOptions, tile: number, group?: number): FPiece {
  const center = add(anchor, mul(up, 2 * stemV - 1)), [u0, v0, u1, v1] = o.rect, piece = newPiece(o, tile, group);
  const ids = [[1, -0.84, u1, v0 + (v1 - v0) * 0.92], [1, 1, u1, v0], [-1, 1, u0, v0], [-1, -0.84, u0, v0 + (v1 - v0) * 0.92]].map(([x, y, u, v]) => {
    const p = add(center, add(mul(right, x), mul(up, y)));
    return pushVertex(piece, p, o.normalAt(p), u, v, o.aoAt(p), o.swayAt(p));
  });
  const root = pushVertex(piece, anchor, o.normalAt(anchor), (u0 + u1) / 2, v0 + (v1 - v0) * stemV, o.aoAt(anchor), 0);
  for (let i = 0; i < 3; i++) piece.tris.push([root, ids[i], ids[i + 1]]);
  return piece;
}

const len3 = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
const dot3 = (a: Vec3, c: Vec3): number => a[0] * c[0] + a[1] * c[1] + a[2] * c[2];

/**
 * The atlas's painted stem starts exactly on a physical shoot, rather than inside an unconnected leaf ball. The spray faces its twig's way
 * (\`facing\`, out of the crown and up toward the light) and fans out in that plane.
 */
function sprig(b: MeshBuilder, rng: Rng, plan: TreePlan, sh: Shading, shoot: Limb, along: number, audit?: TreeContactAudit, dense = false, perLeaf = false, facing: Vec3 = UP): void {
  // The sprays of one twig form a leaf mosaic: they all face the twig's light direction and fan out within that plane, each lying on its own
  // layer (their anchors step along the twig, which climbs through the planes), so neighbours on a twig overlap without ever crossing.
  const tangent = norm(sub(shoot.pts[1], shoot.pts[0])), anchor = add(shoot.pts[0], mul(sub(shoot.pts[1], shoot.pts[0]), along));
  const spread = add(tangent, mul(randomDir(rng), 0.8));
  let direction = sub(spread, mul(facing, dot3(spread, facing)));
  direction = len3(direction) < 1e-3 ? norm(cross(facing, randomDir(rng))) : norm(direction);
  const h = plan.cardSize * rng.range(0.8, 1.25), up = mul(direction, h), right = mul(norm(cross(direction, facing)), h);
  // Flat: bent cards of different directions could not share the layers. The leaves' own fold, curl and tilt are in the atlas normals.
  const shape = FLAT;
  const tile = shootTile(plan, rng), o = cardOptions(sh, tile, plan.foliage, twigPhase + rng.range(-0.015, 0.015), rng.next() < 0.5), mirror = o.rect[0] > o.rect[2];
  // Only shoots on the outside of the crown are built leaf by leaf; the ones inside it, mostly hidden, stay bent cards.
  const outer = perLeaf && shellDepth(plan, anchor) > OUTER_SHELL;
  const layout = outer ? shootLayout(tile) : null, sheet = outer ? sheetFor(tile) : null;
  if (layout && sheet !== null) {
    // The shoot is placed as its card (whose tile paints the same leaves), keeping room for its leaves either side of it, and is then built
    // leaf by leaf in the pose that fitted. Where the whole shoot does not fit, its leaves are fitted one by one into the gaps around it.
    const proxy = shapedCard(anchor, right, up, 0.96, o, shape, 0, tile);
    proxy.spread = SHOOT_SPREAD;
    const placed = fit(proxy, poses(anchor, [facing, direction], 0.25, facing, 0.03, slides(shoot, along)));
    if (!placed) {
      leafShoot(b, rng, plan, sh, o, anchor, right, up, shape, mirror, layout, sheet, true);
      return;
    }
    const frame = newPiece(o, tile);
    for (const p of [anchor, add(anchor, right), add(anchor, up)]) pushVertex(frame, p, UP, 0, 0, 0, 0);
    const [a0, r0, u0] = placed.move(frame).pos;
    standIn = placed.piece;
    leafShoot(b, rng, plan, sh, o, a0, sub(r0, a0), sub(u0, a0), shape, mirror, layout, sheet);
    return;
  }
  // A card that would pass through its neighbours slides along its twig to another layer, lifts, turns about its own stem (spreading the
  // twig's sprays round it) or fans within its plane.
  const placed = settle(b, shapedCard(anchor, right, up, 0.96, o, shape, 0, tile), anchor, [facing, direction], 0.25, facing, 0.03, slides(shoot, along));
  if (placed) audit?.foliage.push(attached(placed, shoot));
}

/**
 * The extreme tier's near shoot as real geometry: the twigs the shoot tile paints, as thin tubes in the bent card's place, and every leaf
 * the tile paints as its own small bent mesh cut from the species' single-leaf sheet, at the painted leaf's place, size and direction but
 * tilted a little on its stalk (facing the shoot's way and up, with a small scatter, so the shoot stays a layer of leaves) and folded along
 * its midrib (two triangles each side; the droop of the tip is in the normals). The end of its stalk stays fixed on the twig.
 */
function leafShoot(b: MeshBuilder, rng: Rng, plan: TreePlan, sh: Shading, o: CardOptions, anchor: Vec3, right: Vec3, up: Vec3, s: CardShape,
  mirror: boolean, layout: ShootLayout, sheet: number, alone = false): void {
  const h = len3(up), face = norm(cross(right, up)), center = add(anchor, mul(up, 0.92)), m = mirror ? -1 : 1;
  // Tile coordinates (u right, v down) to the bent card, as shapedCard places them.
  const at = (tu: number, tv: number): Vec3 => {
    const x = (tu - 0.5) * 2 * m, y = 1 - 2 * tv, t = (y + 0.84) / 1.84;
    return add(add(center, add(mul(right, x), mul(up, y))), mul(face, h * (s.fold * Math.abs(x) - s.curl * t * t + s.twist * x * t)));
  };
  const [u0, v0, u1, v1] = tileRect(sheet), cu = (u1 - u0) / SHEET, cv = (v1 - v0) / SHEET;
  // A shoot placed in the tree as a whole (its card, sprig) only has to keep its leaves out of each other's way; one placed alone fits each
  // leaf among everything else in the tree.
  const shared = space;
  if (!alone && shared) { space = new FoliageSpace(); treeSpace = shared; }
  let leaves = 0;
  for (const l of layout.leaves) {
    const stalk = at(l.bx - l.dx * l.petiole, l.by - l.dy * l.petiole);
    const inPlane = norm(sub(at(l.bx + l.dx * l.len, l.by + l.dy * l.len), at(l.bx, l.by)));
    // The leaf's own facing: the shoot's and a little up toward the light, with a small scatter, and its blade direction kept close to the painted one.
    const n0 = norm(add(add(face, mul(UP, 0.15)), mul(randomDir(rng), 0.2)));
    let a = sub(inPlane, mul(n0, dot3(inPlane, n0)));
    a = len3(a) < 1e-3 ? norm(cross(n0, randomDir(rng))) : norm(add(norm(a), [0, -rng.range(0, 0.35), 0]));
    const n = norm(sub(n0, mul(a, dot3(n0, a)))), lt = cross(n, a);
    const k = (l.len * 2 * h) / (SHEET_BASE_V - SHEET_TIP_V), along = (SHEET_STALK_V - SHEET_TIP_V) * k, half = SHEET_HALF_W * k;
    const fold = Math.tan(rng.range(8, 18) * Math.PI / 180), curl = rng.range(0.05, 0.2), twist = rng.range(-0.15, 0.15), flip = rng.next() < 0.5 ? -1 : 1;
    const cell = rng.int(0, SHEET * SHEET - 1), cx = cell % SHEET, cy = Math.floor(cell / SHEET);
    const piece = newPiece({ ...o, phase: o.phase + rng.range(-0.02, 0.02) }, sheet);
    piece.room = LEAF_LEAF_ROOM; piece.near = tileOpacity(sheet, 2);
    for (const q of [0, 1]) {
      for (const c of [-1, 0, 1]) {
        const p = add(add(add(stalk, mul(a, q * along)), mul(lt, c * half)), mul(n, fold * Math.abs(c) * half - curl * q * q * along + twist * c * q * half));
        const g = norm(add(sub(n, mul(lt, fold * Math.sign(c) + twist * q)), mul(a, 2 * curl * q - 0.5 * twist * c))), cn = o.normalAt(p);
        pushVertex(piece, p, add(mul(cn, 0.5), mul(dot3(g, cn) < 0 ? mul(g, -1) : g, 0.5)),
          u0 + cu * (cx + 0.5 + c * SHEET_HALF_W * flip), v0 + cv * (cy + SHEET_STALK_V - q * (SHEET_STALK_V - SHEET_TIP_V)), o.aoAt(p), q === 0 ? 0 : o.swayAt(p) * q);
      }
    }
    for (let i = 0; i < 2; i++) piece.tris.push([i, i + 1, i + 4], [i, i + 4, i + 3]);
    // A leaf that would pass through a neighbour lifts over or under it, swings aside on its stalk or rolls about its midrib, staying close to
    // the shoot's plane (within SHOOT_SPREAD of it).
    // Filling a gap among the rest of the tree, it only tries its own pose and small lifts: most gaps a leaf fits at all, it fits as it is.
    if (alone) { const f = fit(piece, poses(stalk, [], 0, n, 0.008).slice(0, 5)); if (f) { emit(b, f.piece); leaves++; } }
    else if (settle(b, piece, stalk, [n, a], 0.15, n, 0.008)) leaves++;
  }
  space = shared;
  treeSpace = standIn = null;
  // The twigs carry the leaves' stalks, so they are drawn whenever any leaf is (never a leaf left floating), and not for a shoot left bare.
  if (leaves === 0) return;
  for (const t of layout.twigs) {
    tube(b, [at(t.ax, t.ay), at(t.bx, t.by)], [t.r0 * 2 * h, t.r1 * 2 * h], { sides: 3, kind: plan.bark, sway: (y) => sh.swayAt(y), ao: (p) => o.aoAt(p) });
  }
}

function emitClusters(b: MeshBuilder, rng: Rng, plan: TreePlan, sh: Shading, lod: 0 | 1, wood: Limb[], audit?: TreeContactAudit, dense = false): void {
  // The extreme tier's near LOD builds every leaf of its shoots as geometry (leafShoot).
  const perLeaf = dense && lod === 0;
  const clusters = lod === 1 && !dense && plan.midClusters !== undefined ? plan.clusters.slice(0, plan.midClusters) : plan.clusters;
  for (const cl of clusters) {
    if (plan.radial) {
      if (lod === 0) pineShoots(b, rng, sh, cl, plan.cardsPerCluster * PINE_SHOOTS_PER_CARD, dense, wood, audit);
      else for (let i = 0; i < (dense ? 5 : 3); i++) tuft(b, rng, sh, cl, plan.cardSize * cl.r * 1.3);
    } else if (lod === 0) {
      const attachment = nearestWood(wood, cl.c);
      // One fine shoot per cluster bounds the added geometry; card corners retain the old cluster envelope. A dense crown grows a second
      // shoot from the same twig toward another side, so the cluster fills out to a ball of leaves instead of a fan.
      const reach = Math.max(0.03, cl.r - plan.cardSize * 1.25 * (Math.hypot(1, 1.92) - Math.SQRT2));
      // The per-leaf shoots of the extreme tier are full on their own, so they keep one shoot per cluster.
      for (let s = 0; s < (dense && !perLeaf ? 2 : 1); s++) {
        twigPhase = rng.next();
        const direction = norm(add(sh.normalAt(cl.c), mul(randomDir(rng), 1.5)));
        const shoot: Limb = { pts: [attachment.point, add(cl.c, mul(direction, reach))], radii: [Math.min(0.007, attachment.radius * 0.45), 0.0015], order: 5 };
        tube(b, shoot.pts, shoot.radii, { sides: 3, kind: plan.bark, sway: y => sh.swayAt(y), ao: sh.aoAt });
        audit?.wood.push(shoot);
        // The twig's leaves face out of the crown and up toward the light (so a crown seen from the side shows leaf faces, not edges); the
        // twig must climb through that plane steeply enough that its sprays, evenly spaced along it, sit on separate layers.
        const t = norm(sub(shoot.pts[1], shoot.pts[0]));
        let facing = norm(add(add(mul(UP, 0.6), sh.normalAt(cl.c)), mul(randomDir(rng), 0.35)));
        if (Math.abs(dot3(t, facing)) < 0.4) facing = norm(add(facing, mul(t, (dot3(t, facing) < 0 ? -1 : 1) * 0.6)));
        for (let i = 0; i < plan.cardsPerCluster; i++) sprig(b, rng, plan, sh, shoot, 0.15 + 0.8 * (i + 0.35 + 0.3 * rng.next()) / plan.cardsPerCluster, audit, dense, perLeaf, facing);
      }
    } else {
      // Four cards whose faces point along the corners of a tetrahedron, turned at random: no two are parallel or square to each other, so a
      // cluster keeps a leafy outline from every side, from above included, instead of the thin cross that three square cards leave edge-on.
      const h = cl.r * CLUSTER_CARD, spin = randomDir(rng), turn = rng.range(0, TAU), o = cardOptions(sh, TILE.blob, KIND.blob, rng.next());
      for (const corner of dense ? [...TETRAHEDRON, randomDir(rng), randomDir(rng)] : TETRAHEDRON) {
        const n = rotAxis(corner, spin, turn), across = norm(cross(n, Math.abs(n[1]) < 0.9 ? UP : [1, 0, 0]));
        const right = rotAxis(across, n, rng.range(0, TAU));
        card(b, cl.c, mul(right, h), mul(cross(n, right), h), o);
      }
    }
  }
}

/** 3x3 vertical card spanning the crown; vertex normals sample the crown surface in front of the card so the flat quad shades like a solid volume. */
function billboard(b: MeshBuilder, plan: TreePlan, sh: Shading, yaw: number, tile: number, kind: number, phase: number): void {
  const [cx, cy, cz] = plan.crownC, [rx, ry, rz] = plan.crownR;
  const w = Math.max(rx, rz), y0 = Math.max(cy - ry, 0), hh = (cy + ry - y0) / 2, ym = y0 + hh;
  const rd: Vec3 = [Math.cos(yaw), 0, Math.sin(yaw)], fw: Vec3 = [-Math.sin(yaw), 0, Math.cos(yaw)];
  const [u0, v0, u1, v1] = tileRect(tile);
  const first = b.vertexCount;
  for (let j = 0; j < 3; j++) {
    for (let i = 0; i < 3; i++) {
      const u = i - 1, v = j - 1;
      const p: Vec3 = [cx + rd[0] * w * u, ym + hh * v, cz + rd[2] * w * u];
      const z = rz * Math.sqrt(Math.max(1 - (w * u / rx) ** 2 - (hh * v / ry) ** 2, 0));
      const q = add(p, mul(fw, z));
      b.vertex({ p, n: sh.normalAt(q), u: lerp(u0, u1, i / 2), v: lerp(v1, v0, j / 2), ao: 0.72, sway: sh.swayAt(p[1]), kind, phase });
    }
  }
  for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) b.quad(first + j * 3 + i, first + j * 3 + i + 1, first + (j + 1) * 3 + i + 1, first + (j + 1) * 3 + i);
}

/** Clumps of cards a broadleaf's far LOD crown is built from. */
const LOD2_CLUMPS = 5;

/**
 * The crown's main leaf masses: its leaf clusters grouped into \`k\` by distance (weighted by cluster volume), each a centre and the radius
 * that covers its clusters. Deterministic: the groups start from clusters spread round the crown by angle and height.
 */
function crownClumps(plan: TreePlan, k: number): Cluster[] {
  const cl = plan.clusters, [cx, , cz] = plan.crownC;
  const order = cl.map((c, i) => ({ i, key: Math.atan2(c.c[2] - cz, c.c[0] - cx) + 0.3 * c.c[1] })).sort((a, b) => a.key - b.key);
  let centres: Vec3[] = Array.from({ length: k }, (_, j) => cl[order[Math.floor(((j + 0.5) * cl.length) / k)].i].c);
  const owner = new Int32Array(cl.length);
  for (let iteration = 0; iteration < 12; iteration++) {
    const sums = centres.map(() => [0, 0, 0, 0]);
    cl.forEach((c, i) => {
      let best = 0, bd = Infinity;
      centres.forEach((m, j) => { const d = (c.c[0] - m[0]) ** 2 + (c.c[1] - m[1]) ** 2 + (c.c[2] - m[2]) ** 2; if (d < bd) { bd = d; best = j; } });
      owner[i] = best;
      const w = c.r ** 3, s = sums[best];
      s[0] += c.c[0] * w; s[1] += c.c[1] * w; s[2] += c.c[2] * w; s[3] += w;
    });
    centres = centres.map((m, j) => (sums[j][3] > 0 ? [sums[j][0] / sums[j][3], sums[j][1] / sums[j][3], sums[j][2] / sums[j][3]] : m));
  }
  return centres.map((c, j) => {
    let reach = 0;
    cl.forEach((m, i) => { if (owner[i] === j) reach = Math.max(reach, len3(sub(m.c, c)) + m.r); });
    return { c, r: Math.max(reach, 0.3) };
  }).filter((_, j) => owner.includes(j));
}

/** Trunk stub and the crown: clumps of cards for a broadleaf (crownClumps), otherwise three vertical billboards 60 degrees apart and a horizontal canopy disc. */
function emitBillboards(b: MeshBuilder, rng: Rng, plan: TreePlan, sh: Shading): void {
  const bare = plan.clusters.length === 0 && plan.fronds.length === 0;
  if (plan.species !== 'bush' && plan.species !== 'juniper') {
    // The stub runs on into the crown so there is wood between the ground and the leaves, not a gap that the cards float above; a bare snag
    // is all trunk. It starts as deep as the near trunk so it meets sloping ground the same way.
    const trunk = plan.limbs[0], base = trunk.pts[0][1];
    const top = bare ? trunk.pts[trunk.pts.length - 1][1] : Math.max(0.5, Math.min(plan.crownC[1] + 0.3, 0.6 * plan.height));
    const ys = [base, 0.4, top * 0.5, top];
    tube(b, ys.map((y) => trunkAt(trunk, y)), ys.map((y) => trunkRadiusAt(trunk, y)), {
      sides: plan.trunkSides[2], kind: plan.bark, sway: (y) => sh.swayAt(y), ao: () => 1,
    });
  }
  if (bare) return;
  const cone = plan.species === 'spruce';
  if (!cone && plan.foliage === KIND.leaf && plan.clusters.length >= LOD2_CLUMPS) {
    // A broadleaf crown seen from afar is a heap of leaf masses with dark hollows and sky between them, not one smooth ball: a few clumps
    // of cards at the crown's main leaf masses (three cards each, turned so a clump reads from above as well as from the side), each as
    // large as its mass, so the outline is irregular and the inner and lower clumps come out darker than the outer ones.
    // How far the mid LOD's cluster cards reach from the axis (a card's corner at 1.05 r * sqrt 2 from its cluster's centre).
    const reach = Math.max(...plan.clusters.map((c) => Math.hypot(c.c[0], c.c[2]) + c.r * 1.05 * Math.SQRT2));
    for (const clump of crownClumps(plan, LOD2_CLUMPS)) {
      const o = cardOptions(sh, TILE.blob, KIND.blob, rng.next());
      // The far crown keeps twice the bake's share of the crown occlusion: it has no GI proxies and no finer leaves to carry the depth.
      o.aoAt = (p) => 1 - 2 * (1 - sh.aoAt(p));
      // A card's corner reaches 1.4 times its half size from the clump's centre: kept under the crown's top and inside the reach of the
      // mid LOD's cards round the axis (so the far crown is no wider than the near one, nor than a park planting's footprint).
      const top = plan.crownC[1] + plan.crownR[1], spin = randomDir(rng), turn = rng.range(0, TAU);
      const side = (reach - Math.hypot(clump.c[0], clump.c[2])) / 1.42;
      const h = Math.max(0.2, Math.min(0.8 * clump.r, (top - clump.c[1]) / 1.42, side));
      for (const corner of TETRAHEDRON.slice(0, 3)) {
        const n = rotAxis(corner, spin, turn), across = norm(cross(n, Math.abs(n[1]) < 0.9 ? UP : [1, 0, 0]));
        card(b, clump.c, mul(across, h), mul(cross(n, across), h), o);
      }
    }
    return;
  }
  const yaw0 = rng.range(0, Math.PI);
  for (let i = 0; i < 3; i++) billboard(b, plan, sh, yaw0 + (i * Math.PI) / 3, cone ? TILE.conifer : TILE.blob, cone ? KIND.cone : KIND.blob, rng.next());
  const [cx, cy, cz] = plan.crownC, [rx, ry, rz] = plan.crownR, y = cy + 0.15 * ry;
  card(b, [cx, y, cz], [rx * 0.85, 0, 0], [0, 0, rz * 0.85], {
    rect: tileRect(TILE.blob), kind: KIND.blob, normalAt: () => UP, aoAt: () => 0.8, swayAt: (p) => sh.swayAt(p[1]), phase: rng.next(),
  });
}

/** The three LOD meshes of one plan (LOD0 full geometry, LOD1 merged foliage, LOD2 billboards). */
export function buildTreeLods(plan: TreePlan, seed: number, audit?: TreeContactAudit, foliage: FoliageOptions = {}): [MeshData, MeshData, MeshData] {
  const dense = foliage.dense === true;
  const sh = shading(plan);
  const lods: MeshData[] = [];
  heightSway = sh.swayAt;
  needleRoom = plan.species === 'juniper' ? BUSH_NEEDLE_ROOM : NEEDLE_ROOM;
  for (const lod of [0, 1, 2] as const) {
    const rng = new Rng(deriveSeed(seed, 0x10d, lod)), b = new MeshBuilder();
    space = lod === 0 ? new FoliageSpace() : null;
    emitted = lod === 0 && foliage.pieces ? [] : null;
    if (lod === 2) emitBillboards(b, rng, plan, sh);
    else {
      const wood = emitLimbs(b, plan, sh, lod, dense);
      const nearAudit = lod === 0 ? audit : undefined; nearAudit?.wood.push(...wood);
      emitFronds(b, rng, plan, sh, lod, wood, nearAudit, dense);
      emitClusters(b, rng, plan, sh, lod, wood, nearAudit, dense);
    }
    if (space) foliage.report?.(space);
    if (emitted) foliage.pieces?.(emitted);
    emitted = null;
    space = null;
    lods.push(b.build());
  }
  heightSway = null;
  return lods as [MeshData, MeshData, MeshData];
}
`,$x=`import type { Rng } from '../../world/track/rng';
import { valueNoise2 } from './noise';

const TAU = Math.PI * 2;
export const sat = (x: number): number => Math.min(Math.max(x, 0), 1);

/** One painted point of a leaf tile. */
export interface Sample {
  /** Albedo multiplier, 0..1. */
  shade: number;
  /** Colour shift: 0 deep green, about 0.4 yellow-green, 1 dead yellow-brown. */
  hue: number;
  /** 1 for thin lamina that lets light through, 0 for veins and stems. */
  thin: number;
  /** Surface tilt along the tile's u (right) and v (down) axes, -1..1. */
  tu: number;
  tv: number;
  /** Cavity openness: 1 exposed, small deep inside the canopy. */
  open: number;
}

/** Fills \`out\` and returns true where the tile is opaque at (u, v), both 0..1 with v down. */
export type Painter = (u: number, v: number, out: Sample) => boolean;

export const newSample = (): Sample => ({ shade: 0, hue: 0, thin: 1, tu: 0, tv: 0, open: 1 });

/** Uniform grid of bounded items so a painter only tests the few that overlap a sample; insertion order is paint order. */
export class Grid<T> {
  private readonly cells: T[][];
  constructor(private readonly n: number) {
    this.cells = Array.from({ length: n * n }, () => []);
  }

  private cell(x: number): number {
    return Math.min(Math.max(Math.floor(x * this.n), 0), this.n - 1);
  }

  add(item: T, x0: number, y0: number, x1: number, y1: number): void {
    for (let cy = this.cell(y0); cy <= this.cell(y1); cy++) for (let cx = this.cell(x0); cx <= this.cell(x1); cx++) this.cells[cy * this.n + cx].push(item);
  }

  at(u: number, v: number): readonly T[] {
    return this.cells[this.cell(v) * this.n + this.cell(u)];
  }
}

/** A pointed leaf: base point, unit axis (tile coordinates), length and half width, with veins, midrib and a lobed or toothed margin. */
export interface Leaf {
  bx: number; by: number; dx: number; dy: number; len: number; w: number;
  shade: number; hue: number; open: number;
  lobes: number; lobeAmp: number; lobePhase: number;
  /** Per-leaf tilt along the axis and across it, so neighbouring leaves catch the light differently. */
  bias: number; roll: number;
  /** Slope of each half of the blade up from the midrib (the V of the fold, rising toward the edges) and how far the tip droops. */
  fold: number; curl: number;
  petiole: number;
  /** Outline exponent: the widest point sits where s^widest = 0.5, so below 1 is ovate (birch, widest near the base) and above 1 obovate (oak). */
  widest: number;
  /** Forward-pointing marginal teeth over the blade length and their depth as a fraction of the half width (0 for an entire margin). */
  teeth: number; toothAmp: number;
  /** Fungal or insect spots: [s along the blade, offset across as a fraction of the half width, radius as a fraction of the length] each. */
  spots: [number, number, number][];
  /** Dry, browned margin as a fraction of the half width (0 for none), and a chewed hole [s, across, radius] (radius 0 for none). */
  burn: number;
  hole: [number, number, number];
  /** Seed of the leaf's own mottling. */
  seed: number;
}

export function leafShade(rng: Rng): number {
  return 0.62 + 0.38 * rng.next();
}

/** Mostly deep green, some sun-bleached yellow-green, a few dead yellow-brown leaves. */
export function leafHue(rng: Rng): number {
  const r = rng.next();
  return r < 0.015 ? 0.85 + 0.15 * rng.next() : r < 0.1 ? 0.28 + 0.22 * rng.next() : 0.12 * rng.next();
}

export function makeLeaf(rng: Rng, bx: number, by: number, angle: number, len: number, w: number, lobes: number, lobeAmp: number, open = 1): Leaf {
  const hue = leafHue(rng);
  // About one summer leaf in seven carries a few spots (leaf spot, mildew, mines), one in sixteen a browned edge or a chewed hole.
  const spots: [number, number, number][] = [];
  if (rng.next() < 0.14) for (let k = rng.int(1, 3); k > 0; k--) spots.push([rng.range(0.2, 0.85), rng.range(-0.7, 0.7), rng.range(0.02, 0.05)]);
  const burn = rng.next() < 0.06 ? rng.range(0.08, 0.22) : 0;
  const hole: [number, number, number] = rng.next() < 0.06 ? [rng.range(0.35, 0.8), rng.range(-0.5, 0.5), rng.range(0.05, 0.11)] : [0, 0, 0];
  return {
    bx, by, dx: Math.sin(angle), dy: -Math.cos(angle), len, w, shade: leafShade(rng) * (hue > 0.8 ? 0.78 : 1), hue, open,
    lobes, lobeAmp, lobePhase: rng.range(0, TAU), bias: rng.range(-0.5, 0.5), roll: rng.range(-0.4, 0.4), petiole: 0.06,
    widest: 0.72, teeth: 0, toothAmp: 0, spots, burn, hole, seed: (rng.next() * 0x7fffffff) | 0, fold: rng.range(0.3, 0.75), curl: rng.range(0.3, 0.9),
  };
}

/** Petioles and twigs are pale yellow-green and grey-brown, never black. */
const PETIOLE_SHADE = 0.7;
const PETIOLE_HUE = 0.42;
const TWIG_SHADE = 0.5;
const TWIG_HUE = 0.92;

/** The blade only: true and the sample filled where (u, v) is on the lamina of \`l\`. */
export function paintBlade(l: Leaf, u: number, v: number, o: Sample): boolean {
  const px = u - l.bx, py = v - l.by;
  const s = (px * l.dx + py * l.dy) / l.len;
  if (s <= 0 || s >= 1) return false;
  const lat = -px * l.dy + py * l.dx;
  const a = Math.abs(lat);
  // Deep amplitudes give rounded lobes with narrow sinuses (oak); shallow ones a smooth serrated edge.
  let edge = l.lobeAmp > 0.2
    ? 1 - l.lobeAmp * (1 - Math.pow(Math.abs(Math.sin(s * l.lobes * Math.PI + l.lobePhase)), 0.5))
    : 1 + l.lobeAmp * Math.sin(s * l.lobes * TAU + l.lobePhase);
  if (l.teeth > 0) {
    // Doubly serrate: big forward-pointing teeth, each cut again by three small ones.
    const f = s * l.teeth + (lat >= 0 ? 0 : 0.5), g = f * 3;
    edge *= 1 - l.toothAmp * (f - Math.floor(f)) - 0.35 * l.toothAmp * (g - Math.floor(g));
  }
  const hw = l.w * Math.sin(Math.PI * Math.pow(s, l.widest)) * edge;
  if (a >= hw) return false;
  if (l.hole[2] > 0 && Math.hypot((s - l.hole[0]) * l.len, lat - l.hole[1] * l.w) < l.hole[2] * l.len) return false;
  const r = a / hw;
  const f = s * 7 - r * 1.5;
  const vein = sat(1 - Math.abs(f - Math.floor(f) - 0.5) / 0.09);
  const rib = sat(1 - a / (0.004 + 0.012 * l.w * (1 - s) * 10));
  // Mottling of the lamina at about a tenth of the leaf, so even a single leaf is not one flat colour.
  const mottle = valueNoise2((s * l.len) * 120, lat * 120, l.seed);
  let shade = l.shade * (0.84 + 0.16 * vein + 0.22 * rib) * (1 - 0.14 * r) * (0.9 + 0.2 * mottle);
  let hue = Math.min(l.hue + 0.12 * vein + 0.25 * rib + 0.1 * Math.pow(r, 6), 1);
  let thin = 1 - 0.7 * Math.max(0.6 * vein, rib);
  for (const [ss, sr, rad] of l.spots) {
    const d = Math.hypot((s - ss) * l.len, lat - sr * l.w * 0.6) / (rad * l.len);
    if (d < 1) { hue = Math.max(hue, 0.82 + 0.18 * (1 - d)); shade *= 0.62 + 0.3 * d; thin *= 0.6; }
    else if (d < 1.7) hue = Math.max(hue, Math.min(hue + 0.4 * (1.7 - d), 0.6));
  }
  if (l.burn > 0 && r > 1 - l.burn * (0.6 + 0.8 * mottle)) { hue = 0.93 + 0.07 * mottle; shade *= 0.72; thin *= 0.5; }
  o.shade = shade;
  o.hue = hue;
  o.thin = thin;
  // Across: the V fold rising from the midrib, steepest at the cupped edges, plus the leaf's own roll on its petiole. Along: its own pitch, and
  // the tip drooping more and more toward the end. Each leaf points its own way, so neighbours catch the light differently.
  const across = (lat >= 0 ? 1 : -1) * (l.fold * Math.pow(r, 0.8) + 0.25 * Math.pow(r, 4)) + l.roll, along = l.bias - l.curl * (s * s - 0.33);
  o.tu = across * -l.dy + along * l.dx;
  o.tv = across * l.dx + along * l.dy;
  o.open = l.open;
  return true;
}

/** The petiole only: a thin pale stalk behind the blade's base. */
export function paintPetiole(l: Leaf, u: number, v: number, o: Sample): boolean {
  const px = u - l.bx, py = v - l.by;
  const along = px * l.dx + py * l.dy;
  if (along > 0.02 * l.len || along < -l.petiole) return false;
  if (Math.abs(-px * l.dy + py * l.dx) >= 0.0045) return false;
  o.shade = PETIOLE_SHADE; o.hue = PETIOLE_HUE; o.thin = 0.3; o.tu = 0; o.tv = 0; o.open = l.open;
  return true;
}

export function paintLeaf(l: Leaf, u: number, v: number, o: Sample): boolean {
  return paintBlade(l, u, v, o) || paintPetiole(l, u, v, o);
}

function leafBox(l: Leaf): [number, number, number, number] {
  const tx = l.bx + l.dx * l.len, ty = l.by + l.dy * l.len, e = l.w * (1 + l.lobeAmp) + 0.006;
  const px = -l.dy * e, py = l.dx * e;
  return [Math.min(l.bx, tx) - Math.abs(px), Math.min(l.by, ty) - Math.abs(py), Math.max(l.bx, tx) + Math.abs(px), Math.max(l.by, ty) + Math.abs(py)];
}

/** A woody twig segment from (ax, ay) to (bx, by), radius r0 at a and r1 at b. */
export interface Twig { ax: number; ay: number; bx: number; by: number; r0: number; r1: number }

/** Where a shoot tile's leaves and twigs are (tile coordinates), so the tree can build the same shoot as real geometry. */
export interface ShootLayout { leaves: readonly Leaf[]; twigs: readonly Twig[] }
/** A painter that also reports the layout it paints. */
export type LaidOutPainter = Painter & { layout?: ShootLayout };

function twigHit(t: Twig, u: number, v: number): boolean {
  const dx = t.bx - t.ax, dy = t.by - t.ay;
  const k = sat(((u - t.ax) * dx + (v - t.ay) * dy) / (dx * dx + dy * dy + 1e-12));
  return Math.hypot(u - (t.ax + dx * k), v - (t.ay + dy * k)) < t.r0 + (t.r1 - t.r0) * k;
}

/** Offsets (tile units) toward the light at which an overlying leaf casts its contact shadow, and how dark the full shadow is. */
const SHADOW_TAPS: readonly (readonly [number, number])[] = [[-0.006, -0.01], [-0.012, -0.02], [-0.02, -0.032]];
const SHADOW_DEPTH = 0.5;

/** Painter over leaves (later ones on top) and the twigs that carry them: every blade first, then petioles and twigs behind them. */
function leafPainter(leaves: readonly Leaf[], twigs: readonly Twig[], extra: Painter | null = null): LaidOutPainter {
  const grid = new Grid<Leaf>(12), wood = new Grid<Twig>(12);
  for (const l of leaves) {
    const [x0, y0, x1, y1] = leafBox(l);
    grid.add(l, x0 - l.petiole, y0 - l.petiole, x1 + l.petiole, y1 + l.petiole);
  }
  for (const t of twigs) {
    const m = Math.max(t.r0, t.r1);
    wood.add(t, Math.min(t.ax, t.bx) - m, Math.min(t.ay, t.by) - m, Math.max(t.ax, t.bx) + m, Math.max(t.ay, t.by) + m);
  }
  const order = new Map(leaves.map((l, i) => [l, i]));
  const probe = newSample();
  /** Number of the SHADOW_TAPS offsets toward the light at which a leaf painted later (on top) covers this point of leaf \`l\`. */
  const shadowed = (l: Leaf, u: number, v: number): number => {
    const k = order.get(l) as number;
    let n = 0;
    for (const [dx, dy] of SHADOW_TAPS) {
      const list = grid.at(u + dx, v + dy);
      for (let i = list.length - 1; i >= 0 && order.get(list[i]) as number > k; i--) if (paintBlade(list[i], u + dx, v + dy, probe)) { n++; break; }
    }
    return n;
  };
  const painter: LaidOutPainter = (u, v, o) => {
    const list = grid.at(u, v);
    for (let i = list.length - 1; i >= 0; i--) {
      if (!paintBlade(list[i], u, v, o)) continue;
      // Leaves lying on top of this one shade it: a soft contact shadow just inside their edge, so overlapping leaves read as separate layers.
      const s = shadowed(list[i], u, v);
      // It is lighting, not colour, so it goes into the openness (ambient occlusion) the shader darkens by, not the painted albedo.
      if (s > 0) o.open *= 1 - 1.4 * SHADOW_DEPTH * s / SHADOW_TAPS.length;
      return true;
    }
    for (let i = list.length - 1; i >= 0; i--) if (paintPetiole(list[i], u, v, o)) return true;
    for (const t of wood.at(u, v)) {
      if (!twigHit(t, u, v)) continue;
      o.shade = TWIG_SHADE; o.hue = TWIG_HUE; o.thin = 0; o.tu = 0; o.tv = 0; o.open = 0.7;
      return true;
    }
    return extra ? extra(u, v, o) : false;
  };
  painter.layout = { leaves, twigs };
  return painter;
}

/** Shrinks a leaf so its blade (with lobes) stays inside the tile and above the stem-only strip at the bottom of an anchored card. */
function fit(l: Leaf, margin = 0.02, bottom = 0.9): Leaf {
  for (let it = 0; it < 12; it++) {
    const [x0, y0, x1, y1] = leafBox(l);
    if (x0 >= margin && y0 >= margin && x1 <= 1 - margin && y1 <= bottom) break;
    l.len *= 0.88; l.w *= 0.88;
  }
  return l;
}

/** Point and unit direction of a twig at fraction t of a bent path. */
interface Path { pts: [number, number][] }

function bentPath(x: number, y: number, ang: number, len: number, curl: number, steps: number): Path {
  const pts: [number, number][] = [[x, y]];
  for (let i = 1; i <= steps; i++) {
    const a = ang + curl * (i / steps);
    x += Math.sin(a) * len / steps; y -= Math.cos(a) * len / steps;
    pts.push([x, y]);
  }
  return { pts };
}

function pathAt(p: Path, t: number): [number, number, number] {
  const f = sat(t) * (p.pts.length - 1), i = Math.min(Math.floor(f), p.pts.length - 2), k = f - i;
  const a = p.pts[i], b = p.pts[i + 1];
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, Math.atan2(b[0] - a[0], -(b[1] - a[1]))];
}

function pathTwigs(p: Path, r0: number, r1: number, out: Twig[]): void {
  const n = p.pts.length - 1;
  for (let i = 0; i < n; i++) out.push({ ax: p.pts[i][0], ay: p.pts[i][1], bx: p.pts[i + 1][0], by: p.pts[i + 1][1], r0: r0 + (r1 - r0) * (i / n), r1: r0 + (r1 - r0) * ((i + 1) / n) });
}

/**
 * Oak shoot: a short zigzag twig that forks into four or five shoots, each ending in a crowded rosette of six to eight obovate, deeply lobed
 * leaves (oak leaves bunch at the shoot tips, they do not line a stem like a fern), plus a few single leaves lower down. The leaves at the
 * back of a rosette are drawn first and read as more enclosed. Young leaves near the tips are paler.
 */
export function sprigPainter(rng: Rng): Painter {
  const leaves: Leaf[] = [], twigs: Twig[] = [];
  const oak = (x: number, y: number, ang: number, len: number, open: number): void => {
    const l = makeLeaf(rng, x, y, ang, len, len * rng.range(0.27, 0.33), rng.range(3.6, 5), rng.range(0.42, 0.58), open);
    l.widest = rng.range(1.25, 1.6); l.petiole = 0.012; l.bias = rng.range(-0.35, 0.35); l.roll = rng.range(-0.3, 0.3);
    leaves.push(fit(l));
  };
  const fork: [number, number] = [0.5 + rng.range(-0.03, 0.03), rng.range(0.74, 0.8)];
  const stem = bentPath(0.5, 0.965, rng.range(-0.08, 0.08), 0.965 - fork[1], rng.range(-0.15, 0.15), 4);
  pathTwigs(stem, 0.008, 0.0055, twigs);
  const n = rng.int(4, 5);
  const base = pathAt(stem, 1);
  // Lower single leaves on the main twig, behind everything else.
  for (let k = 0; k < 3; k++) {
    const [x, y, a] = pathAt(stem, rng.range(0.25, 0.6));
    oak(x, y, a + (k === 0 ? -1 : 1) * rng.range(0.9, 1.4), rng.range(0.16, 0.21), 0.6);
  }
  const shoots: Path[] = [];
  for (let i = 0; i < n; i++) {
    const spread = n === 1 ? 0 : -0.75 + 1.5 * (i / (n - 1));
    const p = bentPath(base[0], base[1], spread + rng.range(-0.15, 0.15), rng.range(0.26, 0.38) * (1 - 0.2 * Math.abs(spread)), rng.range(-0.3, 0.3), 3);
    pathTwigs(p, 0.005, 0.0035, twigs);
    shoots.push(p);
  }
  for (const p of shoots) {
    const [x, y, a] = pathAt(p, 0.5);
    oak(x, y, a + (rng.next() < 0.5 ? -1 : 1) * rng.range(0.9, 1.3), rng.range(0.13, 0.18), 0.7);
  }
  for (const p of shoots) {
    const [tx, ty, ta] = pathAt(p, 1);
    const m = rng.int(6, 8);
    // Side leaves of the rosette first (shorter, more enclosed), the leading ones last and on top.
    const order = Array.from({ length: m }, (_, k) => -1.45 + 2.9 * (k + rng.range(-0.25, 0.25)) / (m - 1)).sort((x, y) => Math.abs(y) - Math.abs(x));
    for (const off of order) {
      const lead = 1 - Math.abs(off) / 1.6;
      const l0 = rng.range(0.16, 0.2) + 0.06 * lead;
      oak(tx, ty, ta + off, l0, 0.78 + 0.22 * lead);
      if (lead > 0.6 && rng.next() < 0.35) leaves[leaves.length - 1].hue = Math.min(leaves[leaves.length - 1].hue + 0.1, 0.45);
    }
  }
  return leafPainter(leaves, twigs);
}

/**
 * Silver birch spray: a thin pendulous twig with alternate leaves and short spur shoots of two or three leaves each. The leaves are small,
 * ovate to triangular with a drawn-out tip, doubly serrate, on long stalks, so they hang at many angles and flicker.
 */
export function birchPainter(rng: Rng): Painter {
  const leaves: Leaf[] = [], twigs: Twig[] = [];
  const birch = (x: number, y: number, ang: number, len: number, open: number): void => {
    const l = makeLeaf(rng, x, y, ang, len, len * rng.range(0.34, 0.4), 0, 0, open);
    l.widest = rng.range(0.55, 0.7); l.teeth = rng.range(7, 9); l.toothAmp = rng.range(0.08, 0.13); l.petiole = len * rng.range(0.25, 0.4);
    // Birch leaves sit on stalks: the blade starts a stalk length out from the twig.
    l.bx += l.dx * l.petiole; l.by += l.dy * l.petiole;
    leaves.push(fit(l));
  };
  const side = rng.next() < 0.5 ? -1 : 1;
  const main = bentPath(0.5, 0.965, side * rng.range(0.05, 0.2), rng.range(0.78, 0.86), -side * rng.range(0.4, 0.8), 8);
  pathTwigs(main, 0.0055, 0.0025, twigs);
  const branch = bentPath(...(pathAt(main, rng.range(0.3, 0.4)).slice(0, 2) as [number, number]), -side * rng.range(0.5, 0.8), rng.range(0.32, 0.42), side * rng.range(0.4, 0.8), 5);
  pathTwigs(branch, 0.004, 0.002, twigs);
  for (const [p, count] of [[main, rng.int(18, 22)], [branch, rng.int(11, 14)]] as [Path, number][]) {
    for (let i = 0; i < count; i++) {
      const t = 0.12 + 0.86 * (i + rng.range(-0.2, 0.2)) / count;
      const [x, y, a] = pathAt(p, t);
      const alt = i % 2 === 0 ? 1 : -1;
      if (rng.next() < 0.45) {
        // A spur: a stub of wood with two or three leaves fanned from its tip.
        const sa = a + alt * rng.range(0.7, 1.1), sl = rng.range(0.012, 0.025);
        const sx = x + Math.sin(sa) * sl, sy = y - Math.cos(sa) * sl;
        twigs.push({ ax: x, ay: y, bx: sx, by: sy, r0: 0.0035, r1: 0.003 });
        for (let k = rng.int(2, 3); k > 0; k--) birch(sx, sy, sa + rng.range(-0.8, 0.8), rng.range(0.12, 0.16), 0.85);
      } else birch(x, y, a + alt * rng.range(0.5, 1.2), rng.range(0.12, 0.17) * (1 - 0.2 * t), 0.9);
    }
  }
  return leafPainter(leaves, twigs);
}

/** A canopy blob for the mid-distance LOD: hundreds of small leaves in a lobed, ragged outline, darker toward the interior, with sky gaps. */
export function blobPainter(rng: Rng): Painter {
  const leaves: Leaf[] = [];
  const p1 = rng.range(0, TAU), p2 = rng.range(0, TAU), p3 = rng.range(0, TAU);
  for (let i = 0; i < 760; i++) {
    const a = rng.range(0, TAU), rad = Math.sqrt(rng.next());
    const edge = 0.8 + 0.12 * Math.sin(3 * a + p1) + 0.08 * Math.sin(5 * a + p2) + 0.04 * Math.sin(9 * a + p3);
    if (rad > 0.72 && rng.next() < (rad - 0.72) * 2.4) continue;
    const x = 0.5 + Math.cos(a) * rad * 0.42 * edge, y = 0.5 + Math.sin(a) * rad * 0.39 * edge;
    const len = rng.range(0.07, 0.11) * (1 - 0.25 * rad);
    const ang = rng.range(0, TAU), open = (0.3 + 0.7 * sat((rad - 0.1) / 0.9)) * (0.82 + 0.18 * sat(1 - y));
    const l = makeLeaf(rng, x - Math.sin(ang) * len * 0.5, y + Math.cos(ang) * len * 0.5, ang, len, len * rng.range(0.32, 0.42), 3, 0.1, open);
    l.petiole = 0;
    leaves.push(l);
  }
  const holes = Array.from({ length: 12 }, (_, k) => {
    const a = rng.range(0, TAU), rr = k < 8 ? rng.range(0, 0.28) : rng.range(0.28, 0.4);
    return [0.5 + Math.cos(a) * rr, 0.5 + Math.sin(a) * rr * 0.9, k < 8 ? rng.range(0.016, 0.034) : rng.range(0.03, 0.055)];
  });
  const paint = leafPainter(leaves, []);
  return (u, v, o) => {
    for (const h of holes) if (Math.hypot(u - h[0], v - h[1]) < h[2]) return false;
    return paint(u, v, o);
  };
}

/** Hazel-like shrub shoot: a zigzag twig with two ranks of broad, rounded, doubly serrate leaves with a short point. */
export function shrubPainter(rng: Rng): Painter {
  const leaves: Leaf[] = [], twigs: Twig[] = [];
  const main = bentPath(0.5, 0.965, rng.range(-0.1, 0.1), 0.82, rng.range(-0.3, 0.3), 7);
  pathTwigs(main, 0.007, 0.003, twigs);
  const count = rng.int(9, 11);
  for (let i = 0; i < count; i++) {
    const t = 0.1 + 0.88 * (i + rng.range(-0.15, 0.15)) / count;
    const [x, y, a] = pathAt(main, t);
    const len = rng.range(0.2, 0.26) * (1 - 0.3 * t) + (i === count - 1 ? 0.04 : 0);
    const l = makeLeaf(rng, x, y, a + (i % 2 === 0 ? 1 : -1) * rng.range(0.7, 1.15) * (i === count - 1 ? 0.1 : 1), len, len * rng.range(0.4, 0.46), 0, 0, 0.7 + 0.3 * t);
    // Hazel leaves are thin and fairly pale on the upper face.
    l.widest = rng.range(0.85, 1.05); l.teeth = rng.range(9, 12); l.toothAmp = rng.range(0.05, 0.09); l.petiole = 0.02; l.shade = Math.min(l.shade * 1.1, 1);
    leaves.push(fit(l));
  }
  return leafPainter(leaves, twigs);
}

/**
 * Beech spray: a fine zigzag twig with two or three side shoots, every shoot carrying two flat ranks of alternate leaves that fan out to fill the
 * gaps between them (beech builds a flat mosaic of leaves to catch light). The leaves are ovate with a short point, an entire, gently waved
 * margin and straight parallel veins, 5 to 10 cm long.
 */
export function beechPainter(rng: Rng): Painter {
  const leaves: Leaf[] = [], twigs: Twig[] = [];
  const beech = (x: number, y: number, ang: number, len: number, open: number): void => {
    const l = makeLeaf(rng, x, y, ang, len, len * rng.range(0.3, 0.36), rng.range(5, 8), rng.range(0.035, 0.06), open);
    l.widest = rng.range(0.7, 0.85); l.petiole = 0.012; l.roll = rng.range(-0.15, 0.15);
    leaves.push(fit(l));
  };
  const main = bentPath(0.5, 0.965, rng.range(-0.12, 0.12), 0.84, rng.range(-0.35, 0.35), 9);
  pathTwigs(main, 0.0055, 0.0025, twigs);
  const paths: Path[] = [main];
  for (let k = rng.int(2, 3); k > 0; k--) {
    const [x, y, a] = pathAt(main, rng.range(0.2, 0.55));
    const side = k % 2 === 0 ? 1 : -1;
    const p = bentPath(x, y, a + side * rng.range(0.6, 0.95), rng.range(0.3, 0.42), -side * rng.range(0.1, 0.4), 6);
    pathTwigs(p, 0.0035, 0.0018, twigs);
    paths.push(p);
  }
  for (const p of paths) {
    const count = rng.int(8, 10);
    for (let i = 0; i < count; i++) {
      const t = 0.1 + 0.88 * (i + rng.range(-0.2, 0.2)) / count;
      const [x, y, a] = pathAt(p, t);
      // Two ranks: the leaves alternate sides and lie nearly square to the shoot; the last one points on along it.
      const last = i === count - 1;
      beech(x, y, a + (last ? rng.range(-0.15, 0.15) : (i % 2 === 0 ? 1 : -1) * rng.range(0.85, 1.25)), rng.range(0.16, 0.22) * (1 - 0.25 * t), 0.75 + 0.25 * t);
    }
  }
  return leafPainter(leaves, twigs);
}

/** Hawthorn shoot: small, deeply three- to five-lobed leaves in tufts on short spurs along a stiff twig. */
export function hawthornPainter(rng: Rng): Painter {
  const leaves: Leaf[] = [], twigs: Twig[] = [];
  const main = bentPath(0.5, 0.965, rng.range(-0.1, 0.1), 0.82, rng.range(-0.25, 0.25), 7);
  pathTwigs(main, 0.0065, 0.003, twigs);
  const spurs = rng.int(6, 8);
  for (let i = 0; i < spurs; i++) {
    const t = 0.12 + 0.86 * (i + rng.range(-0.2, 0.2)) / spurs;
    const [x, y, a] = pathAt(main, t);
    const sa = a + (i % 2 === 0 ? 1 : -1) * rng.range(0.5, 1.0), sl = rng.range(0.01, 0.03);
    const sx = x + Math.sin(sa) * sl, sy = y - Math.cos(sa) * sl;
    twigs.push({ ax: x, ay: y, bx: sx, by: sy, r0: 0.004, r1: 0.003 });
    for (let k = rng.int(2, 4); k > 0; k--) {
      const len = rng.range(0.1, 0.15);
      const l = makeLeaf(rng, sx, sy, sa + rng.range(-1.1, 1.1), len, len * rng.range(0.36, 0.44), rng.range(2.6, 3.4), rng.range(0.55, 0.7), 0.75 + 0.25 * t);
      l.widest = rng.range(1.1, 1.4); l.petiole = 0.015;
      leaves.push(fit(l));
    }
  }
  return leafPainter(leaves, twigs);
}

/** Species of a single-leaf sheet tile. */
export type SheetSpecies = 'oak' | 'birch' | 'beech' | 'hazel';
/** Single-leaf sheets are SHEET x SHEET cells, one leaf per cell, its stalk end at the bottom middle of the cell and its tip at the top. */
export const SHEET = 4;
/** Cell coordinates (0..1 within a cell, v down) of a sheet leaf: the end of its stalk, the base of its blade and its tip. */
export const SHEET_STALK_V = 0.97;
export const SHEET_BASE_V = 0.88;
export const SHEET_TIP_V = 0.03;
/** Half width of the cell a sheet leaf may use, as a fraction of the cell. */
export const SHEET_HALF_W = 0.47;

/**
 * A sheet of single leaves of one species, each alone in its cell with its stalk, for the extreme tier's per-leaf geometry: every leaf of a
 * near tree is its own small bent mesh cut from one of these cells, so it shows its real outline, veins and teeth with nothing of its
 * neighbours. The leaves vary in shape, colour and blemishes like the shoot tiles' leaves.
 */
export function sheetPainter(rng: Rng, species: SheetSpecies): Painter {
  const leaves: Leaf[] = [], c = 1 / SHEET, len = (SHEET_BASE_V - SHEET_TIP_V) * c;
  for (let row = 0; row < SHEET; row++) {
    for (let col = 0; col < SHEET; col++) {
      const x = (col + 0.5) * c, y = (row + SHEET_BASE_V) * c;
      const shape = {
        oak: { ratio: rng.range(0.27, 0.33), lobes: rng.range(3.6, 5), amp: rng.range(0.42, 0.58), widest: rng.range(1.25, 1.6), teeth: 0, tooth: 0 },
        birch: { ratio: rng.range(0.34, 0.4), lobes: 0, amp: 0, widest: rng.range(0.55, 0.7), teeth: rng.range(7, 9), tooth: rng.range(0.08, 0.13) },
        beech: { ratio: rng.range(0.3, 0.36), lobes: rng.range(5, 8), amp: rng.range(0.035, 0.06), widest: rng.range(0.7, 0.85), teeth: 0, tooth: 0 },
        hazel: { ratio: rng.range(0.4, 0.46), lobes: 0, amp: 0, widest: rng.range(0.85, 1.05), teeth: rng.range(9, 12), tooth: rng.range(0.05, 0.09) },
      }[species];
      const w = Math.min(len * shape.ratio, (SHEET_HALF_W * c) / (1 + shape.amp));
      const l = makeLeaf(rng, x, y, 0, len, w, shape.lobes, shape.amp, 1);
      l.widest = shape.widest; l.teeth = shape.teeth; l.toothAmp = shape.tooth; l.petiole = (SHEET_STALK_V - SHEET_BASE_V) * c;
      if (species === 'hazel') l.shade = Math.min(l.shade * 1.1, 1);
      leaves.push(l);
    }
  }
  return leafPainter(leaves, []);
}
`,eS=`import { Rng } from '../../world/track/rng';
import { hash2 } from './noise';
import { Grid, sat, type Painter, type Sample } from './treeLeafShapes';

const TAU = Math.PI * 2;

/** One needle (or scale-leaf run): a capsule from (ax, ay) to (bx, by) in tile coordinates. */
interface Needle { ax: number; ay: number; bx: number; by: number; r: number; shade: number; hue: number; open: number; tu: number; tv: number }

function needleDist(n: Needle, u: number, v: number): number {
  const dx = n.bx - n.ax, dy = n.by - n.ay;
  const t = sat(((u - n.ax) * dx + (v - n.ay) * dy) / (dx * dx + dy * dy + 1e-12));
  return Math.hypot(u - (n.ax + dx * t), v - (n.ay + dy * t));
}

/** Texels per tile side of the splat raster: the leaf atlas tile size, so each texel centre the atlas samples reads exactly one needle. */
export const NEEDLE_RES = 512;
const NEEDLE_RES_DEFAULT = NEEDLE_RES;

/** Painter over capsules, later ones on top: each capsule is splatted once into an id raster, so a spray of 100000 needles costs about as much as one of 1000. */
function needlePainter(needles: readonly Needle[], extra: Painter | null, NEEDLE_RES = NEEDLE_RES_DEFAULT): Painter {
  const ids = new Int32Array(NEEDLE_RES * NEEDLE_RES).fill(-1);
  needles.forEach((n, id) => {
    const x0 = Math.max(Math.floor((Math.min(n.ax, n.bx) - n.r) * NEEDLE_RES), 0), x1 = Math.min(Math.ceil((Math.max(n.ax, n.bx) + n.r) * NEEDLE_RES), NEEDLE_RES - 1);
    const y0 = Math.max(Math.floor((Math.min(n.ay, n.by) - n.r) * NEEDLE_RES), 0), y1 = Math.min(Math.ceil((Math.max(n.ay, n.by) + n.r) * NEEDLE_RES), NEEDLE_RES - 1);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (needleDist(n, (x + 0.5) / NEEDLE_RES, (y + 0.5) / NEEDLE_RES) < n.r) ids[y * NEEDLE_RES + x] = id;
  });
  return (u, v, o) => {
    const id = ids[Math.min(Math.max(Math.floor(v * NEEDLE_RES), 0), NEEDLE_RES - 1) * NEEDLE_RES + Math.min(Math.max(Math.floor(u * NEEDLE_RES), 0), NEEDLE_RES - 1)];
    if (id < 0) return extra ? extra(u, v, o) : false;
    const n = needles[id];
    o.shade = n.shade; o.hue = n.hue; o.thin = 0.55; o.tu = n.tu; o.tv = n.tv; o.open = n.open;
    return true;
  };
}

/** Shoots and the leader are orange-brown bark, not dark green. */
const WOOD_SHADE = 0.38;
const WOOD_HUE = 0.85;
/** Fine shoots inside a spray are young bark, still mostly green. */
const SHOOT_HUE = 0.15;
/** Needle radius in tile units: about 1.3 texels across at 512 texels per tile, so a needle on a 1.5 m spray is about 4 mm wide where a real one is 1.5. */
export const NEEDLE_R = 0.0013;
/** Spacing of needles along a shoot: a real spruce shoot carries one every 1.5-2 mm all round, about 1 mm per side on a 1.5 m card. */
const NEEDLE_STEP = 0.0013;
/** Distance between secondary branchlets along a side shoot: about 3 cm on a 1.5 m spray. */
const SUB_STEP = 0.02;
/** Needles painted at each step along a shoot (one fewer at random). */
const NEEDLES_PER_STEP = 8;

/**
 * Bottle-brush shoot from (sx, sy) along \`ang\` (clockwise from up), drooping by \`sag\` and turning its tip up again: a thin stem with
 * forward-swept needles on both flanks and along the top, paler at the new-growth tip. Returns the tip position.
 */
function shoot(rng: Rng, out: Needle[], sx: number, sy: number, ang: number, reach: number, needle: number, open: number, sag: number): [number, number] {
  const side = ang < 0 ? -1 : 1;
  const steps = Math.max(8, Math.round(reach / NEEDLE_STEP));
  let x = sx, y = sy;
  let prevX = x, prevY = y;
  for (let k = 1; k <= steps; k++) {
    const f = k / steps;
    const a = ang + side * sag * (f - 1.6 * f * f);
    x += Math.sin(a) * reach / steps;
    y -= Math.cos(a) * 0.9 * reach / steps;
    if (k % 6 === 0 || k === steps) {
      out.push({ ax: prevX, ay: prevY, bx: x, by: y, r: 0.0011, shade: 0.45, hue: SHOOT_HUE, open, tu: 0, tv: 0 });
      prevX = x; prevY = y;
    }
    if (f < 0.04) continue;
    const len = needle * (0.65 + 0.35 * Math.sin(Math.PI * Math.min(f * 0.9 + 0.1, 1))) * rng.range(0.8, 1.2);
    const fresh = sat((f - 0.72) / 0.28);
    // Needles stand all round a real shoot, so seen from any side its brush is nearly solid out to the needle tips: two on the flanks and the
    // rest spread over the brush (with three or four a spray card painted only a quarter of its tile and a crown of them read as a skeleton).
    const count = rng.next() < 0.5 ? NEEDLES_PER_STEP : NEEDLES_PER_STEP - 1;
    for (let j = 0; j < count; j++) {
      const flank = j % 2 === 0 ? -1 : 1;
      const spread = j >= 2 ? rng.range(-1, 1) : flank * rng.range(0.4, 1.2);
      const na = a + spread;
      out.push({
        ax: x, ay: y, bx: x + Math.sin(na) * len, by: y - Math.cos(na) * len * 0.9, r: NEEDLE_R,
        shade: (0.5 + 0.45 * rng.next()) * (0.85 + 0.25 * fresh), hue: fresh > 0.4 && rng.next() < 0.5 ? 0.3 + 0.12 * rng.next() : 0.05 * rng.next(),
        open: open * (0.75 + 0.25 * f), tu: flank * 0.4 + rng.range(-0.15, 0.15), tv: rng.range(-0.3, 0.3),
      });
    }
  }
  return [x, y];
}

/**
 * A spruce or fir spray: a gently curved leader with irregular, drooping side shoots that shorten toward the tip and carry short secondary
 * shoots, every one a fine bottle-brush of forward-swept needles. Older needles near the base are darker; the new growth at the tips is a
 * paler yellow-green.
 */
/** Where a spray tile's leader and side shoots run (tile coordinates), so the tree can build the spray as real shoots. */
export interface SprayLayout { leader: [number, number][]; shoots: { ax: number; ay: number; bx: number; by: number }[] }

export function sprayPainter(rng: Rng, res = NEEDLE_RES): Painter & { spray: SprayLayout } {
  const needles: Needle[] = [], layout: SprayLayout = { leader: [], shoots: [] };
  const leader = (t: number): [number, number] => [0.5 + 0.03 * Math.sin(t * 2.6), 0.97 - 0.85 * t];
  for (let i = 0; i < 14; i++) {
    const [ax, ay] = leader(i / 14), [bx, by] = leader((i + 1) / 14);
    needles.push({ ax, ay, bx, by, r: 0.0026, shade: WOOD_SHADE, hue: WOOD_HUE, open: 0.8, tu: 0, tv: 0 });
    layout.leader.push([ax, ay]);
  }
  layout.leader.push(leader(1));
  const shoots = 17;
  for (let s = 0; s < shoots; s++) {
    const t = Math.min(0.03 + 0.9 * ((s + rng.range(-0.3, 0.3)) / (shoots - 1)), 0.93);
    const [sx, sy] = leader(t);
    for (const side of [-1, 1]) {
      if (rng.next() < 0.1) continue;
      const reach = 0.4 * (1 - 0.6 * t) * rng.range(0.65, 1.12);
      const ang = side * (1.1 - 0.35 * t + rng.range(-0.18, 0.18));
      const [ex, ey] = shoot(rng, needles, sx, sy, ang, reach, 0.0135, 0.8, rng.range(0.15, 0.5));
      layout.shoots.push({ ax: sx, ay: sy, bx: ex, by: ey });
      const subs = Math.round(reach / SUB_STEP);
      for (let k = 0; k < subs; k++) {
        if (rng.next() < 0.12) continue;
        const f = 0.12 + 0.82 * ((k + rng.range(-0.3, 0.3)) / Math.max(subs - 1, 1));
        const side2 = k % 2 === 0 ? 1 : -1;
        shoot(rng, needles, sx + (ex - sx) * f, sy + (ey - sy) * f, ang + side2 * rng.range(0.7, 1.1), 0.2 * reach * (1 - 0.65 * f) * rng.range(0.7, 1.25), 0.0105, 0.6, rng.range(0.1, 0.4));
      }
    }
  }
  const [tx, ty] = leader(1);
  shoot(rng, needles, tx, ty + 0.02, 0, 0.07, 0.011, 1, 0);
  return Object.assign(needlePainter(needles, null, res), { spray: layout });
}

/**
 * Scots pine branch end: three or four branchlets fanning out from the card's base, each forking once into a whorl of side shoots, and every
 * shoot a dense brush of paired needles 5 to 8 cm long that point forward and outward, fullest just behind the tip. Needles are grey to
 * blue-green, a little paler on the newest growth, with a few yellowing needles of the oldest year class deep inside the brush. With
 * \`single\`, one branchlet standing straight up the tile with its whorl and needles in proportion to it: the shoot the near LOD builds a pine's
 * branch ends from.
 */
export function pinePainter(rng: Rng, res = NEEDLE_RES, single = false): Painter {
  const needles: Needle[] = [];
  // A single shoot is drawn about half a metre long, so its needles are a larger share of it: 5 to 8 cm on a real shoot of 30 to 50.
  const needleScale = single ? 1.9 : 1;
  const brush = (x: number, y: number, ang: number, reach: number, curl: number, depth: number): void => {
    let px = x, py = y;
    const steps = Math.max(8, Math.round(reach / 0.0028));
    for (let k = 1; k <= steps; k++) {
      const f = k / steps, a = ang + curl * f;
      x += Math.sin(a) * reach / steps; y -= Math.cos(a) * reach / steps;
      if (k % 5 === 0 || k === steps) { needles.push({ ax: px, ay: py, bx: x, by: y, r: 0.0024 * (1 - 0.5 * f), shade: WOOD_SHADE, hue: WOOD_HUE, open: 0.6, tu: 0, tv: 0 }); px = x; py = y; }
      if (depth === 0 && k === Math.round(steps * rng.range(0.45, 0.6))) {
        // The whorl: two side shoots leave the branchlet about half way out.
        for (const side of [-1, 1]) brush(x, y, a + side * rng.range(0.5, 0.85), reach * rng.range(0.4, 0.55), -side * rng.range(0, 0.3), 1);
      }
      if (f < 0.3) continue;
      // Needle pairs every few millimetres of shoot; the brush is fullest about two thirds of the way out.
      const full = Math.sin(Math.PI * Math.min((f - 0.3) / 0.75, 1));
      // Pairs stand all round the shoot; seen from the side about two pairs per step fill the brush.
      for (let j = 0; j < 4; j++) {
        const side = j % 2 === 0 ? -1 : 1;
        const na = a + side * rng.range(j < 2 ? 0.35 : 0.1, 1.05);
        const len = (0.024 + 0.018 * full) * rng.range(0.8, 1.15) * needleScale;
        const old = f < 0.5 && rng.next() < 0.07;
        needles.push({
          ax: x, ay: y, bx: x + Math.sin(na) * len, by: y - Math.cos(na) * len, r: NEEDLE_R,
          shade: (0.55 + 0.4 * rng.next()) * (0.8 + 0.25 * f), hue: old ? 0.7 + 0.2 * rng.next() : f > 0.85 && rng.next() < 0.4 ? 0.25 + 0.1 * rng.next() : 0.06 * rng.next(),
          open: (0.55 + 0.45 * f) * (depth === 0 ? 1 : 0.9), tu: side * 0.45 + rng.range(-0.2, 0.2), tv: rng.range(-0.3, 0.3),
        });
      }
    }
  };
  if (single) brush(0.5, 0.955, rng.range(-0.05, 0.05), 0.86, rng.range(-0.1, 0.1), 0);
  else {
    const n = rng.int(3, 4);
    for (let s = 0; s < n; s++) {
      const ang = -0.6 + 1.2 * ((s + rng.range(-0.2, 0.2)) / (n - 1));
      brush(0.5, 0.955, ang, rng.range(0.7, 0.85) * (1 - 0.25 * Math.abs(ang)), rng.range(-0.2, 0.2), 0);
    }
  }
  // Nothing may reach the tile border, where bilinear taps and mips would bleed into the neighbouring tile.
  const inside = (x: number, y: number): boolean => x > 0.01 && x < 0.99 && y > 0.01 && y < 0.99;
  return needlePainter(needles.filter((k) => inside(k.ax, k.ay) && inside(k.bx, k.by)), null, res);
}

/**
 * A hanging spruce branchlet seen from the side, painted base at the bottom and tip at the top of the tile: a thin shoot densely clothed all
 * round in short needles (a bottle-brush), with alternate side shoots that shorten toward the tip. Needles next to the shoot are more enclosed
 * than the outer ones, and the new growth at the tips is paler. The tree drapes these along curved ribbons hanging from each branch.
 */
export function brushPainter(rng: Rng, res = NEEDLE_RES): Painter {
  const needles: Needle[] = [];
  const ang = rng.range(-0.08, 0.08);
  const [tx, ty] = shoot(rng, needles, 0.5, 0.97, ang, 0.9, 0.05, 0.6, rng.range(0, 0.15));
  const subs = rng.int(8, 11);
  for (let k = 0; k < subs; k++) {
    const f = 0.08 + 0.8 * (k + rng.range(-0.3, 0.3)) / subs;
    const sx = 0.5 + (tx - 0.5) * f, sy = 0.97 + (ty - 0.97) * f;
    const side = k % 2 === 0 ? 1 : -1;
    shoot(rng, needles, sx, sy, ang + side * rng.range(0.55, 1.0), rng.range(0.2, 0.32) * (1 - 0.45 * f), 0.038, 0.8, rng.range(0.1, 0.35));
  }
  // Nothing may reach the tile border, where bilinear taps and mips would bleed into the neighbouring tile.
  const inside = (x: number, y: number): boolean => x > 0.01 && x < 0.99 && y > 0.01 && y < 0.99;
  return needlePainter(needles.filter((k) => inside(k.ax, k.ay) && inside(k.bx, k.by)), null, res);
}

/** A drooping branch seen from the side: a tapered capsule from the trunk (ax, ay) to the tip (bx, by), radius r0 at the trunk and r1 at the tip. */
interface Skirt { ax: number; ay: number; bx: number; by: number; r0: number; r1: number; shade: number; hue: number }

/** Position along the skirt (0 at the trunk, 1 at the tip) when (u, v) is inside it, else -1. */
function skirtHit(k: Skirt, u: number, v: number): number {
  const dx = k.bx - k.ax, dy = k.by - k.ay;
  const t = sat(((u - k.ax) * dx + (v - k.ay) * dy) / (dx * dx + dy * dy + 1e-12));
  const r = k.r0 + (k.r1 - k.r0) * t;
  const d = Math.hypot(u - (k.ax + dx * t), v - (k.ay + dy * t)) / r;
  return d < 1 ? t : -1;
}

/**
 * A far spruce silhouette seen from the side: whorls of drooping branches (the ones pointing at the viewer fold into a dense core, the ones
 * pointing sideways make the ragged outline), thick at the trunk and thinning to needle-clump tips, dark deep inside and paler at the tips.
 */
export function conifer(seed: number): Painter {
  const rng = new Rng(seed);
  const skirts: Skirt[] = [];
  const whorls = 24;
  for (let k = 0; k < whorls; k++) {
    const t = (k + rng.range(0.15, 0.85)) / whorls, y = 0.045 + 0.865 * Math.pow(t, 0.95);
    const reach = 0.05 + 0.43 * Math.pow(t, 0.85);
    const count = 13;
    for (let b = 0; b < count; b++) {
      const az = (b / count) * TAU + k * 1.9 + rng.range(-0.25, 0.25);
      const side = Math.sin(az), len = reach * Math.abs(side) * rng.range(0.6, 1.08);
      const droop = (0.016 + 0.085 * t) * (0.35 + Math.abs(side)) * rng.range(0.7, 1.3);
      skirts.push({
        ax: 0.5, ay: y, bx: 0.5 + Math.sign(side) * len, by: y + droop, r0: 0.02 + 0.026 * t, r1: 0.011 + 0.012 * t,
        shade: 0.55 + 0.4 * rng.next(), hue: rng.next() < 0.3 ? 0.3 + 0.1 * rng.next() : 0.06 * rng.next(),
      });
    }
  }
  skirts.push({ ax: 0.5, ay: 0.18, bx: 0.5, by: 0.025, r0: 0.014, r1: 0.003, shade: 0.8, hue: 0.32 });
  const grid = new Grid<Skirt>(20);
  for (const k of skirts) {
    const m = k.r0 + 0.004;
    grid.add(k, Math.min(k.ax, k.bx) - m, Math.min(k.ay, k.by) - m, Math.max(k.ax, k.bx) + m, Math.max(k.ay, k.by) + m);
  }
  return (u, v, o) => {
    if (v > 0.93) {
      if (v < 0.985 && Math.abs(u - 0.5) < 0.02) { o.shade = 0.28; o.hue = 0; o.thin = 0; o.tu = 0; o.tv = 0; o.open = 0.4; return true; }
      return false;
    }
    const list = grid.at(u, v);
    for (let i = list.length - 1; i >= 0; i--) {
      const k = list[i], t = skirtHit(k, u, v);
      if (t < 0) continue;
      const along = sat(t), fray = hash2(Math.floor(u * 230), Math.floor(v * 230), seed);
      if (along > 0.55 && fray < (along - 0.55) * 1.1) continue;
      const lat = Math.sign(k.bx - k.ax), up = Math.sign(v - (k.ay + (k.by - k.ay) * along));
      o.shade = Math.min(k.shade * (0.62 + 0.5 * along) * (0.85 + 0.3 * fray), 1);
      o.hue = along > 0.8 ? Math.max(k.hue, 0.28) : k.hue;
      o.thin = 0.5;
      o.tu = lat * 0.45 * along;
      o.tv = 0.2 * up;
      o.open = 0.22 + 0.78 * along;
      return true;
    }
    return false;
  };
}
`,tS=`import type { MeshData } from './meshBuilder';
import { VARIANT_DEFS, type VariantAsset, type VariantDef } from './variants';

// Built tree variants packed into one transferable buffer, for the disk cache (treeCache.ts) and the build workers (treeBuildPool.ts).

/** The meshes and bounds of every variant in one buffer: a header of counts, then each mesh's arrays back to back. */
export function packAssets(assets: readonly VariantAsset[]): ArrayBuffer {
  const meshes = assets.flatMap((a) => a.lods);
  const parts: ArrayBufferView[] = [];
  const header = new Float64Array(1 + assets.length * 3 + meshes.length * 2);
  let h = 0;
  header[h++] = assets.length;
  for (const a of assets) { header[h++] = a.height; header[h++] = a.centreY; header[h++] = a.radius; }
  for (const m of meshes) { header[h++] = m.vertexCount; header[h++] = m.idx.length; }
  parts.push(header);
  for (const m of meshes) parts.push(m.pos, m.nrm, m.uv, m.attr, m.idx);
  // Each array starts on a 4-byte boundary.
  const size = parts.reduce((n, p) => n + Math.ceil(p.byteLength / 4) * 4, 0);
  const out = new Uint8Array(size);
  let o = 0;
  for (const p of parts) { out.set(new Uint8Array(p.buffer, p.byteOffset, p.byteLength), o); o += Math.ceil(p.byteLength / 4) * 4; }
  return out.buffer;
}

/** Assets packed by packAssets, for the variants \`defs\` (every variant by default); null if the buffer does not hold that many. */
export function unpackAssets(buffer: ArrayBuffer, defs: readonly VariantDef[] = VARIANT_DEFS): VariantAsset[] | null {
  const count = new Float64Array(buffer, 0, 1)[0];
  if (count !== defs.length) return null;
  const header = new Float64Array(buffer, 0, 1 + count * 3 + count * 3 * 2);
  let o = header.byteLength, h = 1 + count * 3;
  const take = <T extends ArrayBufferView>(make: (b: ArrayBuffer, off: number, n: number) => T, n: number, bytes: number): T => {
    const v = make(buffer, o, n);
    o += Math.ceil((n * bytes) / 4) * 4;
    return v;
  };
  const meshes: MeshData[] = [];
  for (let k = 0; k < count * 3; k++) {
    const vertexCount = header[h++], indices = header[h++];
    meshes.push({
      vertexCount,
      pos: take((b, off, n) => new Float32Array(b, off, n), vertexCount * 3, 4),
      nrm: take((b, off, n) => new Float32Array(b, off, n), vertexCount * 3, 4),
      uv: take((b, off, n) => new Float32Array(b, off, n), vertexCount * 2, 4),
      attr: take((b, off, n) => new Uint8Array(b, off, n), vertexCount * 4, 1),
      idx: take((b, off, n) => new Uint32Array(b, off, n), indices, 4),
    });
  }
  if (o !== buffer.byteLength) return null;
  return defs.map((def, i) => ({
    def, lods: [meshes[i * 3], meshes[i * 3 + 1], meshes[i * 3 + 2]], height: header[1 + i * 3], centreY: header[2 + i * 3], radius: header[3 + i * 3],
  }));
}
`,nS=`import type { Vec3 } from '../../contracts';
import { Rng } from '../../world/track/rng';
import { KIND, add, cross, dot, mul, norm, sub } from './meshBuilder';

const TAU = Math.PI * 2;
const UP: Vec3 = [0, 1, 0];
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/**
 * A woody segment: centreline, radius at each point, and its branching order (0 trunk or stem, 1 primary limb, 2 secondary, 3 twig).
 * A dead limb is bare grey wood with no leaves; a root runs from the trunk foot out into the ground.
 */
export interface Limb { pts: Vec3[]; radii: number[]; order: number; parent?: Limb; dead?: boolean; root?: boolean }
/** A conifer spray card pair: \`c\` is its centre, \`t\` the unit direction of the needle tips, \`len\` and \`width\` in metres. */
export interface Frond { c: Vec3; t: Vec3; len: number; width: number; branch: number }
/** A ball of leaf cards (or radial needle tufts) of radius \`r\` around \`c\`. */
export interface Cluster { c: Vec3; r: number }

export type Species = 'spruce' | 'pine' | 'oak' | 'birch' | 'beech' | 'snag' | 'bush' | 'juniper';

/** Root flare of a trunk foot: \`count\` root ridges up to \`amp\` of the trunk radius proud, fading out over \`height\` metres; \`phase\` turns them. */
export interface Flare { count: number; amp: number; height: number; phase: number }

export interface TreePlan {
  species: Species;
  height: number;
  /** Crown ellipsoid: centre and radii, used for shading normals, ambient occlusion and the LOD2 billboards. */
  crownC: Vec3;
  crownR: Vec3;
  /** Trunk radius at breast height (1.3 m), metres at scale 1. */
  trunkRadius: number;
  bark: number;
  limbs: Limb[];
  fronds: Frond[];
  clusters: Cluster[];
  /**
   * How many of the clusters (the first ones) the mid-distance LOD draws below the extreme tier, when the near crown carries more than a
   * mid-distance tree needs; unset, it draws them all.
   */
  midClusters?: number;
  /** Leaf cards per cluster, their half size (m), whether cards radiate from the cluster centre (pine tufts) and the atlas kind. */
  cardsPerCluster: number;
  cardSize: number;
  radial: boolean;
  foliage: number;
  /** Bark rings of the trunk at each LOD (LOD0..2). */
  trunkSides: [number, number, number];
  /** Root flare of the trunk (none for shrubs) and the relative height of the swellings of the trunk and thick limbs (0 for a smooth stem). */
  flare?: Flare;
  gnarl?: number;
}

/** The trunk runs on this far (m) below the ground at its foot, so it still meets the soil on the downhill side of a 30 degree slope. */
export const TRUNK_FOOT = -0.8;
/** Height (m) at which a trunk's radius is quoted (breast height, as foresters measure). */
export const BREAST_HEIGHT = 1.3;

export function pol(yaw: number, elev: number): Vec3 {
  const c = Math.cos(elev);
  return [c * Math.sin(yaw), Math.sin(elev), c * Math.cos(yaw)];
}

/** Rodrigues rotation of \`v\` about the unit axis \`k\`. */
export function rotAxis(v: Vec3, k: Vec3, a: number): Vec3 {
  const c = Math.cos(a), s = Math.sin(a), d = dot(k, v) * (1 - c);
  const kv = cross(k, v);
  return [v[0] * c + kv[0] * s + k[0] * d, v[1] * c + kv[1] * s + k[1] * d, v[2] * c + kv[2] * s + k[2] * d];
}

/** Random unit vector, uniform on the sphere. */
export function randomDir(rng: Rng): Vec3 {
  const y = rng.range(-1, 1), a = rng.range(0, TAU), r = Math.sqrt(1 - y * y);
  return [r * Math.cos(a), y, r * Math.sin(a)];
}

export function pointAt(pts: readonly Vec3[], s: number): Vec3 {
  const f = Math.min(Math.max(s, 0), 1) * (pts.length - 1);
  const i = Math.min(Math.floor(f), pts.length - 2), t = f - i;
  return [lerp(pts[i][0], pts[i + 1][0], t), lerp(pts[i][1], pts[i + 1][1], t), lerp(pts[i][2], pts[i + 1][2], t)];
}

export function tangentAt(pts: readonly Vec3[], s: number): Vec3 {
  const i = Math.min(Math.floor(Math.min(Math.max(s, 0), 1) * (pts.length - 1)), pts.length - 2);
  return norm(sub(pts[i + 1], pts[i]));
}

/** Point on a near-vertical trunk at world height y. */
export function trunkAt(trunk: Limb, y: number): Vec3 {
  const p = trunk.pts;
  let i = 0;
  while (i < p.length - 2 && p[i + 1][1] < y) i++;
  const t = Math.min(Math.max((y - p[i][1]) / Math.max(p[i + 1][1] - p[i][1], 1e-6), 0), 1);
  return [lerp(p[i][0], p[i + 1][0], t), y, lerp(p[i][2], p[i + 1][2], t)];
}

export function trunkRadiusAt(trunk: Limb, y: number): number {
  const p = trunk.pts;
  let i = 0;
  while (i < p.length - 2 && p[i + 1][1] < y) i++;
  const t = Math.min(Math.max((y - p[i][1]) / Math.max(p[i + 1][1] - p[i][1], 1e-6), 0), 1);
  return lerp(trunk.radii[i], trunk.radii[i + 1], t);
}

/**
 * The extreme tier's fuller crown: a broadleaf also carries leaf clusters along its living branches, not only at the twig ends, so its crown
 * fills in to the density and depth of a real one. The wood and the existing clusters are unchanged; conifers keep their sprays.
 */
export function densify(plan: TreePlan): TreePlan {
  if (plan.foliage !== KIND.leaf || plan.radial || plan.clusters.length === 0) return plan;
  const r = (0.75 * plan.clusters.reduce((t, c) => t + c.r, 0)) / plan.clusters.length;
  // Two clusters along every living secondary and finer branch, and an inner layer along the outer half of each primary limb, so the crown
  // is leafy through its depth as well as at its rim.
  const extra: Cluster[] = [];
  for (const l of plan.limbs) {
    if (l.dead || l.root || l.order < 1) continue;
    for (const s of l.order === 1 ? [0.6, 0.85] : [0.35, 0.75]) extra.push({ c: pointAt(l.pts, s), r: l.order === 1 ? 1.2 * r : r });
  }
  return { ...plan, clusters: [...plan.clusters, ...extra] };
}

/**
 * Ring heights of a trunk from its foot below ground to \`top\`: close together over the root flare, where the shape changes fastest,
 * then \`n\` even steps to the top.
 */
export function trunkHeights(top: number, n: number): number[] {
  const ys = [TRUNK_FOOT, -0.15, 0.08, 0.3, 0.6, 1.0];
  const from = 1.0;
  for (let i = 1; i <= n; i++) ys.push(from + ((top - from) * i) / n);
  return ys;
}

/** Breast-height radius with the swelling of the flare (which rises a little above it on big trees) taken out. */
export const breastRadius = (trunk: Limb): number => trunkRadiusAt(trunk, BREAST_HEIGHT);

/** Leaning, wobbling trunk from below the ground up to \`height\`, swelling into its roots at the foot; \`taperPower\` above 1 keeps it stout for longer. */
export function trunkLimb(rng: Rng, height: number, r0: number, r1: number, lean: number, wobble: number, n: number, taperPower = 1.25): Limb {
  const az = rng.range(0, TAU);
  const wx = rng.range(0, 100), wz = rng.range(0, 100);
  const pts: Vec3[] = [], radii: number[] = [];
  for (const y of trunkHeights(height, n)) {
    const f = (y - TRUNK_FOOT) / (height - TRUNK_FOOT);
    const h = Math.max(y, 0) / height;
    const bend = lean * h * h;
    pts.push([Math.sin(az) * bend + wobble * Math.sin(f * 6.1 + wx), y, Math.cos(az) * bend + wobble * Math.sin(f * 5.3 + wz)]);
    radii.push((r1 + (r0 - r1) * Math.pow(1 - h, taperPower)) * (1 + 0.35 * Math.exp(-Math.max(y, 0) / 0.45)));
  }
  return { pts, radii, order: 0 };
}

/** The first ring frame of a tube along \`pts\` (mirrors meshBuilder.tube), so roots can be laid along the flare's ridges. */
function footFrame(pts: readonly Vec3[]): [Vec3, Vec3] {
  const t = norm(sub(pts[1], pts[0]));
  const nx = norm(cross(t, Math.abs(t[1]) < 0.95 ? UP : [1, 0, 0]));
  return [nx, cross(t, nx)];
}

/**
 * Surface roots: one along each root ridge of the flare, leaving the trunk at the ground and diving into it within about a trunk diameter,
 * so the foot of the tree grips the soil instead of standing on it like a post.
 */
/**
 * A log lying on the ground beside a tree: a snag's snapped top, a limb an old tree has shed, or a windthrown neighbour. It is drawn wood
 * only (no collider, no leaves; the near LOD only), half sunk into the litter, with snapped, narrower ends. It draws from its own stream
 * (\`seed\`), so the rest of the tree grows the same with or without it. \`length\` and \`radius\` are in metres at scale 1.
 */
export function fallenLog(seed: number, trunk: Limb, length: number, radius: number): Limb {
  const rng = new Rng(seed);
  const az = rng.range(0, TAU), side = rng.range(0.4, 1.2) * (rng.next() < 0.5 ? -1 : 1);
  const clear = trunkRadiusAt(trunk, 0.3) * 1.6 + radius + rng.range(0.3, 1.0);
  const d: Vec3 = [Math.sin(az), 0, Math.cos(az)], n: Vec3 = [Math.cos(az), 0, -Math.sin(az)];
  const start = add(mul(d, clear), mul(n, side));
  const pts: Vec3[] = [], radii: number[] = [];
  const bow = rng.range(-0.25, 0.25), segs = Math.max(4, Math.round(length / 0.8));
  for (let i = 0; i <= segs; i++) {
    const s = i / segs, r = radius * lerp(1, 0.7, s) * (i === 0 || i === segs ? 0.75 : 1);
    pts.push(add(add(start, mul(d, length * s)), [n[0] * bow * Math.sin(s * Math.PI), r * 0.45, n[2] * bow * Math.sin(s * Math.PI)]));
    radii.push(r);
  }
  return { pts, radii, order: 1, dead: true, parent: trunk };
}

export function surfaceRoots(rng: Rng, trunk: Limb, flare: Flare, reach: number): Limb[] {
  const [nx, bx] = footFrame(trunk.pts), r = trunkRadiusAt(trunk, 0.3), out: Limb[] = [];
  for (let k = 0; k < flare.count; k++) {
    if (rng.next() < 0.25) continue;
    // The draws are the same four per root as before the roots were reshaped, so the rest of the tree grows the same.
    const lengthDraw = (rng.range(0.75, 1.15) - 0.75) / 0.4, wig = rng.range(-1, 1), widthDraw = (rng.range(0.42, 0.55) - 0.42) / 0.13;
    // Roots leave the trunk at irregular angles and are of unequal size, so the foot is no regular star.
    const ang = (TAU * (k + 0.5 - flare.phase + 0.3 * wig)) / flare.count;
    const dir: Vec3 = [nx[0] * Math.cos(ang) + bx[0] * Math.sin(ang), 0, nx[2] * Math.cos(ang) + bx[2] * Math.sin(ang)];
    // A buttress root is broad where it leaves the trunk and is lost in the soil within one to two trunk radii of the flare.
    const d = norm(dir), base = trunkAt(trunk, 0.1), len = Math.min(reach, 0.3 + 1.5 * r) * (0.55 + 0.8 * lengthDraw), side = norm(cross(d, UP));
    const pts: Vec3[] = [], radii: number[] = [];
    const r0 = r * (0.3 + 0.35 * widthDraw);
    for (let i = 0; i <= 6; i++) {
      const s = i / 6, out = r * 0.3 + len * s, rr = r0 * lerp(1, 0.18, Math.pow(s, 0.7));
      // It rises out of the flare as a rounded ridge, runs down along the soil and dives in, narrowing fast. The lower trunk is sheared onto
      // the ground's plane (tree.wgsl footOnSlope), so on a slope the root follows the ground instead of standing out of it.
      const y = rr * lerp(0.3, -0.5, s) - rr * 1.6 * Math.pow(Math.max(0, (s - 0.45) / 0.55), 1.5);
      pts.push(add(add([base[0], y, base[2]], mul(d, out)), mul(side, 0.1 * wig * len * Math.sin(s * 3))));
      radii.push(rr);
    }
    out.push({ pts, radii, order: 1, root: true, parent: trunk });
  }
  return out;
}

/** Integrates a branch centreline: the direction is nudged by \`bend(s)\` (vertical bias, +up) and random wobble at every step. */
function growBranch(rng: Rng, base: Vec3, dir0: Vec3, length: number, segs: number, bend: (s: number) => number, wobble: number): Vec3[] {
  const pts: Vec3[] = [base];
  let d = norm(dir0), p = base;
  for (let i = 1; i <= segs; i++) {
    const s = i / segs;
    d = norm(add(add(d, mul(UP, bend(s) / segs)), mul(randomDir(rng), wobble / segs)));
    p = add(p, mul(d, length / segs));
    pts.push(p);
  }
  return pts;
}

function taper(r0: number, r1: number, n: number, power = 1): number[] {
  return Array.from({ length: n }, (_, i) => lerp(r0, r1, Math.pow(i / (n - 1), power)));
}

function crownFrom(points: readonly Vec3[], pad: number): { c: Vec3; r: Vec3 } {
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (const p of points) {
    x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]);
    y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]);
    z0 = Math.min(z0, p[2]); z1 = Math.max(z1, p[2]);
  }
  return { c: [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], r: [(x1 - x0) / 2 + pad, (y1 - y0) / 2 + pad, (z1 - z0) / 2 + pad] };
}

/**
 * Dead side branches on a bare stretch of trunk from \`y0\` to \`y1\`: thin grey twigs that the shade of the crown above has killed, most of
 * them snapped short, the rest still reaching out and down. \`whorls\` gives conifer rings of them instead of a scatter.
 */
export function deadBranches(rng: Rng, trunk: Limb, y0: number, y1: number, count: number, reach: number, whorls: boolean): Limb[] {
  const out: Limb[] = [];
  const rings = whorls ? Math.max(1, Math.round(count / 4)) : count;
  for (let k = 0; k < rings; k++) {
    const y = lerp(y0, y1, (k + rng.range(0.2, 0.8)) / rings);
    const per = whorls ? rng.int(3, 5) : 1, off = rng.range(0, TAU);
    for (let j = 0; j < per; j++) {
      const az = off + (TAU * (j + rng.range(-0.2, 0.2))) / per;
      const snapped = rng.next() < 0.75;
      const len = reach * (snapped ? rng.range(0.06, 0.22) : rng.range(0.3, 0.7)) * lerp(1.15, 0.8, (y - y0) / Math.max(y1 - y0, 1e-3));
      const dir = pol(az, rng.range(-0.45, 0.05)), r = trunkRadiusAt(trunk, y);
      const base = add(trunkAt(trunk, y), mul([dir[0], 0, dir[2]], r * 0.6));
      const pts = growBranch(rng, base, dir, len, snapped ? 1 : 3, () => -0.3, 0.5);
      out.push({ pts, radii: taper(Math.min(0.012 + 0.02 * len, r * 0.4), snapped ? 0.009 : 0.003, pts.length), order: 1, dead: true, parent: trunk });
    }
  }
  return out;
}

/** How a spruce has grown: crown reach (fraction of height), where the live crown starts, dead twigs below it, hanging sprays, and lean. */
export interface SpruceForm { reach: number; crownBase: number; deadBelow: boolean; droop: number; lean: number }

/**
 * Whorled spruce: straight trunk, rings of branches that droop and turn up at their tips and shorten toward the top, three needle fronds per
 * branch. A forest-grown one has its live crown high up and a stretch of dead grey twigs below; an open-grown one is green to the ground.
 */
export function sprucePlan(rng: Rng, height: number, form: SpruceForm): TreePlan {
  const trunk = trunkLimb(rng, height, 0.0165 * height + 0.03, 0.02, form.lean, 0.05, 12);
  const limbs: Limb[] = [trunk], fronds: Frond[] = [];
  const y0 = form.crownBase * height, span = 0.985 * height - y0;
  let y = y0, branch = 0;
  while (y < 0.985 * height) {
    const t = (y - y0) / span;
    const nb = t < 0.45 ? 7 : t < 0.8 ? 6 : 5;
    const L = Math.max(0.55, form.reach * height * Math.pow(1 - t, 0.85));
    const off = rng.range(0, TAU);
    for (let k = 0; k < nb; k++) {
      const yy = y + rng.range(-0.1, 0.1);
      const az = off + ((k + rng.range(-0.2, 0.2)) * TAU) / nb;
      const dir = pol(az, lerp(-0.12, 0.75, t * t));
      const base = add(trunkAt(trunk, yy), mul([dir[0], 0, dir[2]], trunkRadiusAt(trunk, yy) * 0.5));
      const len = L * rng.range(0.85, 1.12);
      const pts = growBranch(rng, base, dir, len, 8, (s) => -0.75 * (1 - t) * (1 - s) + 1.1 * s * s * (0.5 + t), 0.2);
      const r = 0.012 + 0.014 * len;
      limbs.push({ pts, radii: taper(r, 0.005, 9), order: 1, parent: trunk });
      for (const s of [0.42, 0.72, 0.97]) {
        const tg = tangentAt(pts, s);
        // Lower sprays hang from their branch (the comb form of old spruces); the tips stay level.
        const hang = form.droop * (1 - t) * (1 - s * 0.6);
        const tip = norm(add(tg, [0, -hang, 0]));
        const flen = Math.max(0.7, len * 0.46);
        fronds.push({ c: add(pointAt(pts, s), mul(tip, flen * 0.15)), t: tip, len: flen, width: flen * 0.95, branch });
      }
      branch++;
    }
    y += 0.8 * lerp(1, 0.42, t);
  }
  for (let i = 0; i < 4; i++) {
    const az = (i / 4) * TAU + rng.range(0, 0.6);
    const tg = norm(add(mul(UP, 3), pol(az, 0.2)));
    fronds.push({ c: add(trunkAt(trunk, height - 0.45), mul(tg, 0.5)), t: tg, len: 1.4, width: 1.1, branch });
  }
  if (form.deadBelow) limbs.push(...deadBranches(rng, trunk, 1.2, y0 - 0.3, Math.round((y0 - 1.5) / 1.1) * 2, form.reach * height * 0.55, true));
  const flare: Flare = { count: rng.int(5, 7), amp: 0.55, height: 0.5, phase: rng.next() };
  limbs.push(...surfaceRoots(rng, trunk, flare, 0.4 + 2.2 * trunk.radii[2]));
  // An old spruce stand has windthrown trunks lying in it.
  if (form.droop >= 1) limbs.push(fallenLog(Math.round(height * 997) + 3, trunk, 0.4 * height, 0.009 * height + 0.02));
  const R = form.reach * height * 1.05;
  return {
    species: 'spruce', height, crownC: [0, (y0 + height) / 2 + 0.03 * height, 0], crownR: [R, (height - y0) / 2 + 0.03 * height, R], trunkRadius: breastRadius(trunk),
    bark: KIND.spruceBark, limbs, fronds, clusters: [], cardsPerCluster: 0, cardSize: 0, radial: false, foliage: KIND.needle, trunkSides: [14, 6, 4],
    flare, gnarl: 0.025,
  };
}

/**
 * A Scots pine limb's side branches: two to four leave it between a third of the way out and near its end, rising and spreading, 0.6 to 1.8 m
 * long, and about half fork once more near their tip; every branch end carries a needle clump. That is what makes the clumped, dark crown
 * of a mature pine instead of a few tufts at the ends of bare limbs. The draws come from their own stream (\`rng\`), so the trunk, the limbs
 * and the clusters at the limb ends grow the same with or without them. \`t\` is the limb's place up the crown (0 bottom, 1 top).
 */
function pineSecondaries(rng: Rng, limb: Limb, length: number, t: number, limbs: Limb[], clusters: Cluster[]): void {
  const count = rng.int(2, 4), radius = lerp(0.6, 0.45, t);
  for (let k = 0; k < count; k++) {
    const s = lerp(0.3, 0.88, (k + rng.range(0.15, 0.85)) / count), at = pointAt(limb.pts, s), tg = tangentAt(limb.pts, s);
    const side = norm(cross(tg, UP)), flip = k % 2 === 0 ? 1 : -1;
    const dir = norm(add(add(tg, mul(side, flip * rng.range(0.6, 1.1))), [0, rng.range(0.25, 0.6), 0]));
    const len = Math.min(1.8, Math.max(0.6, length * rng.range(0.25, 0.42)));
    const pts = growBranch(rng, at, dir, len, 3, () => 0.35, 0.25);
    const branch: Limb = { pts, radii: taper(0.012 + 0.008 * len, 0.006, pts.length), order: 2, parent: limb };
    limbs.push(branch);
    // A clump at the tip and one along the branch's outer part.
    clusters.push({ c: add(pts[pts.length - 1], [0, 0.1, 0]), r: radius });
    clusters.push({ c: add(pointAt(pts, 0.55), [0, 0.08, 0]), r: radius * 0.85 });
    if (rng.next() < 0.5) {
      // A last fork near the tip, turned the other way: a tuft at the fork and one at its end.
      const fork = growBranch(rng, pointAt(pts, 0.7), norm(add(tangentAt(pts, 0.7), mul(side, -flip * 0.8))), len * 0.45, 2, () => 0.3, 0.2);
      limbs.push({ pts: fork, radii: taper(0.008, 0.005, fork.length), order: 3, parent: branch });
      clusters.push({ c: add(fork[fork.length - 1], [0, 0.08, 0]), r: radius * 0.8 });
      clusters.push({ c: add(fork[0], [0, 0.06, 0]), r: radius * 0.7 });
    }
  }
}

/** How a Scots pine has grown: where its crown starts, how many limbs, how far they reach, trunk lean and crookedness, and dead stubs below. */
export interface PineForm { crownStart: number; limbs: number; spread: number; lean: number; wobble: number; stubs: number }

/**
 * Scots pine: a tall trunk, grey and fissured below and orange-barked above (the bark shader follows the trunk radius), a high crown of
 * long crooked limbs ending in radiating needle tufts, and snapped-off stubs of old lower branches along the bare stretch.
 */
export function pinePlan(rng: Rng, height: number, form: PineForm): TreePlan {
  const trunk = trunkLimb(rng, height, 0.0155 * height + 0.04, 0.02, form.lean, form.wobble, 14, 1.1);
  const limbs: Limb[] = [trunk], clusters: Cluster[] = [];
  const n = form.limbs;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const yy = height * lerp(form.crownStart, 0.96, t) + rng.range(-0.3, 0.3);
    const L = Math.max(1.4, lerp(4.6, 1.6, t) * form.spread * rng.range(0.8, 1.2));
    const dir = pol(rng.range(0, TAU), lerp(0.05, 0.6, t));
    const base = trunkAt(trunk, yy);
    const pts = growBranch(rng, base, dir, L, 6, (s) => 0.35 + 0.5 * s - 0.6 * (1 - t), 0.45 + 0.3 * form.wobble);
    const limb: Limb = { pts, radii: taper(0.03 + 0.012 * L, 0.01, 7), order: 1, parent: trunk };
    limbs.push(limb);
    // Needles clothe the outer part of the limb in small clumps, not one big ball at its end.
    for (const s of [0.55, 0.7, 0.85, 1]) clusters.push({ c: add(pointAt(pts, s), [0, 0.12, 0]), r: lerp(0.65, 0.5, t) });
    pineSecondaries(new Rng(Math.round(height * 977) + 31 * i + 11), limb, L, t, limbs, clusters);
  }
  clusters.push({ c: add(trunkAt(trunk, height), [0, 0.3, 0]), r: 0.9 });
  if (form.stubs > 0) limbs.push(...deadBranches(rng, trunk, 2, height * form.crownStart - 0.5, form.stubs, 1.6, false));
  const crown = crownFrom(clusters.map((c) => c.c), 1);
  const flare: Flare = { count: rng.int(5, 6), amp: 0.32, height: 0.45, phase: rng.next() };
  limbs.push(...surfaceRoots(rng, trunk, flare, 0.3 + 1.8 * trunk.radii[2]));
  return {
    species: 'pine', height, crownC: crown.c, crownR: crown.r, trunkRadius: breastRadius(trunk), bark: KIND.pineBark,
    limbs, fronds: [], clusters, cardsPerCluster: 5, cardSize: 1, radial: true, foliage: KIND.needle, trunkSides: [14, 6, 4],
    flare, gnarl: 0.035,
  };
}
`,rS=`import type { Vec3 } from '../../contracts';
import { Rng } from '../../world/track/rng';
import { KIND, add, mul, norm } from './meshBuilder';
import { growPath, killLimb, sprout, taperRadii, type Level, type Tip } from './treeBranch';
import { breastRadius, fallenLog, pointAt, pol, randomDir, surfaceRoots, trunkHeights, type Cluster, type Flare, type Frond, type Limb, type TreePlan } from './treePlan';

const TAU = Math.PI * 2;
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

function crownOf(points: readonly Vec3[], pad: number): { c: Vec3; r: Vec3 } {
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (const p of points) {
    x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]);
    y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]);
    z0 = Math.min(z0, p[2]); z1 = Math.max(z1, p[2]);
  }
  return { c: [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], r: [(x1 - x0) / 2 + pad, (y1 - y0) / 2 + pad, (z1 - z0) / 2 + pad] };
}

/** Random point in the shell of the crown ellipsoid between radius fractions f0 and f1, above \`minY\`. */
function shellPoint(rng: Rng, c: Vec3, r: Vec3, f0: number, f1: number, minY: number): Vec3 {
  for (let i = 0; i < 12; i++) {
    const d = randomDir(rng), f = lerp(f0, f1, Math.cbrt(rng.next()));
    const p: Vec3 = [c[0] + d[0] * r[0] * f, c[1] + d[1] * r[1] * f, c[2] + d[2] * r[2] * f];
    if (p[1] >= minY) return p;
  }
  return [c[0], Math.max(c[1], minY), c[2]];
}

/**
 * Leaf clusters at the branch tips plus \`fillers\` more. Fillers go in the shell of the crown, or (the share \`clump\` of them) next to a tip, outward and
 * up from it, so the leaves gather into masses round the branch sprays with sky between them rather than an even shell.
 */
function foliageFromTips(rng: Rng, tips: readonly Tip[], fillers: number, minFillY: number, shell: [number, number], clump = 0): { clusters: Cluster[]; c: Vec3; r: Vec3 } {
  const crown = crownOf(tips.map((t) => t.p), 0.8);
  const clusters: Cluster[] = tips.map((t) => ({ c: t.p, r: t.r }));
  const avg = tips.reduce((s, t) => s + t.r, 0) / Math.max(tips.length, 1);
  for (let i = 0; i < fillers; i++) {
    if (i < fillers * clump && tips.length > 0) {
      const t = tips[rng.int(0, tips.length - 1)];
      const out = norm([t.p[0] - crown.c[0], 0.6 * Math.max(t.p[1] - crown.c[1], 0) + 0.5, t.p[2] - crown.c[2]]);
      // Kept within a cluster's width of the tip, so the leaves hang on the spray's own twigs instead of floating past it.
      const d = norm(add(out, mul(randomDir(rng), 0.9)));
      clusters.push({ c: add(t.p, mul(d, t.r * rng.range(0.35, 0.8))), r: t.r * rng.range(0.85, 1.1) });
    } else clusters.push({ c: shellPoint(rng, crown.c, crown.r, shell[0], shell[1], minFillY), r: avg * rng.range(0.85, 1.1) });
  }
  return { clusters, ...crown };
}

/**
 * A short broadleaf bole from below the ground to the fork at \`fy\`, curving gently toward \`az\`, with the root swell at its foot. \`r0\` is its
 * radius at the ground, \`crook\` how far it wanders sideways (m).
 */
function bole(fy: number, r0: number, az: number, crook: number, rng: Rng): Limb {
  const wx = rng.range(0, 10), wz = rng.range(0, 10);
  const pts: Vec3[] = trunkHeights(fy, 8).map((y) => {
    const f = Math.max(y, 0) / fy;
    return [Math.sin(az) * crook * f * f + 0.05 * Math.sin(f * 7 + wx), y, Math.cos(az) * crook * f * f + 0.05 * Math.sin(f * 5 + wz)] as Vec3;
  });
  return { pts, radii: pts.map((p) => lerp(r0, r0 * 0.7, Math.max(p[1], 0) / fy) * (1 + 0.55 * Math.exp(-Math.max(p[1], 0) / 0.5))), order: 0 };
}

/**
 * Inner branches die in the shade of the crown and the odd big limb dies or snaps on an old tree: \`big\` is the chance per primary limb,
 * \`small\` per secondary branch. Dead wood keeps its main twigs and loses its leaves. The draws come from their own stream (\`seed\`), so the
 * living crown grows the same whatever dies in it.
 */
function deadwood(seed: number, limbs: Limb[], tips: Tip[], big: number, small: number): void {
  const rng = new Rng(seed);
  // A limb that forks into further limbs (an oak's scaffold) is not killed whole; its arms are, one by one.
  const forks = new Set(limbs.filter((l) => l.order === 1).map((l) => l.parent));
  for (const l of limbs.filter((l) => l.order === 1 && !l.root && !forks.has(l))) if (rng.next() < big) killLimb(limbs, tips, l, 2, rng.next() < 0.6 ? rng.range(0.35, 0.85) : 1);
  for (const l of limbs.filter((l) => l.order === 2 && !l.dead)) if (rng.next() < small) killLimb(limbs, tips, l, 3, rng.next() < 0.5 ? rng.range(0.3, 0.8) : 1);
}

// Branches on an oak's scaffold limbs: crooked secondaries, then the twiggy sprays that carry the leaf masses. The high wobble over few
// segments gives the angular, zig-zag growth of oak wood rather than smooth curves.
const OAK_LEVELS: readonly Level[] = [
  { count: 3, start: 0.25, end: 0.9, angle: [0.6, 1.1], length: [0.4, 0.6], segs: 5, bend: 0.35, wobble: 2.4, radius: 0.55, tipRadius: 0.02 },
  { count: 3, start: 0.2, end: 0.92, angle: [0.5, 1.0], length: [0.42, 0.65], segs: 4, bend: 0.1, wobble: 2.0, radius: 0.58, tipRadius: 0.012 },
  { count: 2, start: 0.3, end: 0.95, angle: [0.4, 0.9], length: [0.5, 0.75], segs: 3, bend: -0.1, wobble: 1.4, radius: 0.62, tipRadius: 0.006 },
];

// Branches off the short first stretch of a scaffold limb, before it forks: long for where they start, reaching up into the middle of the
// crown and out between the arms.
const OAK_INNER: Level = { count: 2, start: 0.4, end: 0.95, angle: [0.6, 1.1], length: [0.9, 1.3], segs: 4, bend: 0.4, wobble: 2.0, radius: 0.45, tipRadius: 0.02 };

// Leaf clusters an oak's mid-distance LOD draws: about what the whole crown had before the near crown was filled out, so the many trees at
// mid distance cost what they did.
const OAK_MID_CLUSTERS = 250;

/** The same items with an evenly strided \`n\` of them moved to the front, in their order, then the rest. */
function spreadFirst<T>(items: readonly T[], n: number): T[] {
  const first: T[] = [], rest: T[] = [];
  items.forEach((item, i) => (Math.floor(((i + 1) * n) / items.length) > Math.floor((i * n) / items.length) ? first : rest).push(item));
  return [...first, ...rest];
}

/**
 * The radii of a limb whose cross-section holds until it gives off branches, then falls away toward the tip, as the pipe model has it: the
 * wood a limb carries is the sum of the wood of what grows from it.
 */
function heavyRadii(r0: number, r1: number, n: number): number[] {
  return taperRadii(r0, r1, n, 1.7);
}

/** Points of a crooked limb: straight runs with abrupt changes of direction at each node, rising by \`bend\` (as growPath). */
function crookedPath(rng: Rng, base: Vec3, dir0: Vec3, length: number, segs: number, bend: (s: number) => number, kink: number): Vec3[] {
  return growPath(rng, base, dir0, length, segs, bend, kink * segs * 0.5);
}

/**
 * How an oak has grown. \`fork\` is where the bole divides (fraction of height), \`limbs\` the range of primary limbs, \`reach\` their length,
 * \`upright\` how steeply they rise, \`trunk\` the bole's girth, \`dead\` the share of dead and broken wood, \`gnarl\` how lumpy the bole is.
 */
export interface OakForm { fork: number; limbs: [number, number]; reach: number; upright: number; trunk: number; dead: number; gnarl: number }

/**
 * Spreading oak: a short stout bole with a root flare forking into crooked limbs, then secondary and tertiary branches and twigs, leaf clusters
 * at the twig ends. Open-grown oaks fork low into a broad crown; forest oaks carry a taller bole and a narrower, higher crown; veterans are
 * squat and thick with dead and snapped limbs (stag-headed).
 */
export function oakPlan(rng: Rng, height: number, form: OakForm): TreePlan {
  const fy = form.fork * height;
  const az0 = rng.range(0, TAU);
  const r0 = (0.028 * height + 0.05) * form.trunk;
  const trunk = bole(fy, r0, az0, 0.5, rng);
  const top = trunk.pts.length - 1;
  const limbs: Limb[] = [trunk], tips: Tip[] = [];
  // The bole divides into a few heavy scaffold limbs; their cross-sections together carry the bole's (pipe model), so each is well over
  // half its girth. Each runs crooked out and up for a stretch, then forks again into two, and those carry the branches and leaf masses.
  const nl = rng.int(form.limbs[0], form.limbs[1]), scaffolds = nl;
  const rFork = r0 * 0.72, weights = Array.from({ length: scaffolds }, () => rng.range(0.8, 1.2)), wsum = weights.reduce((a, b) => a + b, 0);
  const options = { levels: OAK_LEVELS.slice(0, 2), order0: 1, tipRadius: { 3: 0.95 }, tipFrom: 3, limbs, tips };
  for (let i = 0; i < scaffolds; i++) {
    const az = az0 + ((i + rng.range(-0.1, 0.1)) * TAU) / scaffolds;
    const rLimb = rFork * Math.sqrt(weights[i] / wsum) * 1.15;
    const reach = height * form.reach * rng.range(0.6, 0.72) * Math.sqrt(weights[i] / (wsum / scaffolds));
    const from = trunk.pts[top - (i % 2)];
    const elev = rng.range(0.35, 0.7) + 0.6 * form.upright;
    const split = rng.range(0.32, 0.5);
    const pts = crookedPath(rng, from, pol(az, Math.min(elev, 1.45)), reach * split, 4, () => 0.35 + form.upright, 0.55);
    const limb: Limb = { pts, radii: heavyRadii(rLimb, rLimb * 0.8, pts.length), order: 1, parent: trunk };
    limbs.push(limb);
    // Inner branches off the scaffold itself fill the middle and the top of the dome.
    sprout(rng, limb, { ...options, levels: [OAK_INNER, OAK_LEVELS[1]] });
    // The fork: two arms of unequal weight, one rising, one spreading, their girths again adding up to the limb's.
    const tg = norm([pts[4][0] - pts[3][0], pts[4][1] - pts[3][1], pts[4][2] - pts[3][2]]);
    const heading = Math.atan2(tg[0], tg[2]), climb = Math.asin(Math.max(-1, Math.min(1, tg[1])));
    const share = rng.range(0.35, 0.5);
    for (const [k, w] of [[0, 1 - share], [1, share]] as const) {
      const side = (k === 0 ? 1 : -1) * rng.range(0.4, 0.8);
      const armElev = k === 0 ? Math.min(climb + rng.range(0.2, 0.45), 1.3) : Math.max(climb - rng.range(0.3, 0.6), 0.05);
      const dir = pol(heading + side, Math.max(-0.2, Math.min(1.4, armElev)));
      // The spreading arm reaches furthest; the rising one is shorter, so the crown grows wide rather than tall.
      const armLen = reach * (1 - split) * (k === 0 ? rng.range(0.95, 1.1) : rng.range(1.0, 1.2));
      const armPts = crookedPath(rng, pts[4], dir, armLen, 6, (s) => (k === 0 ? 0.4 : 0.45) + form.upright - 0.9 * s, 0.45);
      const rArm = rLimb * 0.8 * Math.sqrt(w) * 1.1;
      const arm: Limb = { pts: armPts, radii: heavyRadii(rArm, 0.03, armPts.length), order: 1, parent: limb };
      limbs.push(arm);
      sprout(rng, arm, options);
    }
  }
  // Leaves grow all along the outer sprays and the secondary branches, not only at their ends, so the masses fill out.
  for (const l of limbs) {
    if (l.order === 3) for (const s of [0.3, 0.55, 0.8]) tips.push({ p: pointAt(l.pts, s), r: 0.85, order: 3, limb: l });
    if (l.order === 2) tips.push({ p: pointAt(l.pts, 0.7), r: 0.9, order: 2, limb: l });
  }
  deadwood(Math.round(height * 977 + form.dead * 131), limbs, tips, form.dead, 0.05 + 0.25 * form.dead);
  const flare: Flare = { count: rng.int(5, 7), amp: 0.75, height: 1.0, phase: rng.next() };
  limbs.push(...surfaceRoots(rng, trunk, flare, 0.5 + 2.5 * r0));
  const f = foliageFromTips(rng, tips, Math.round(420 * (1 - 0.6 * form.dead)), trunk.pts[top][1] + 0.2, [0.45, 0.92], 0.4);
  // An old oak sheds big limbs, which lie under it for years.
  if (form.dead >= 0.3) limbs.push(fallenLog(Math.round(height * 991) + 7, trunk, 0.35 * height, 0.35 * r0));
  // The mid-distance LOD draws an even share of the clusters (as many as the crown had before it was filled out for the near LOD).
  const mid = Math.min(f.clusters.length, OAK_MID_CLUSTERS), clusters = spreadFirst(f.clusters, mid);
  return {
    species: 'oak', height, crownC: f.c, crownR: f.r, trunkRadius: breastRadius(trunk), bark: KIND.bark,
    limbs, fronds: [], clusters, midClusters: mid, cardsPerCluster: 11, cardSize: 0.45, radial: false, foliage: KIND.leaf, trunkSides: [16, 6, 4],
    flare, gnarl: form.gnarl,
  };
}

const BEECH_LEVELS: readonly Level[] = [
  { count: 3, start: 0.25, end: 0.9, angle: [0.4, 0.8], length: [0.42, 0.62], segs: 5, bend: 0.25, wobble: 0.55, radius: 0.55, tipRadius: 0.02 },
  { count: 3, start: 0.2, end: 0.95, angle: [0.55, 1.0], length: [0.4, 0.62], segs: 4, bend: -0.15, wobble: 0.6, radius: 0.58, tipRadius: 0.01 },
  { count: 3, start: 0.2, end: 0.95, angle: [0.6, 1.1], length: [0.45, 0.7], segs: 3, bend: -0.35, wobble: 0.5, radius: 0.6, tipRadius: 0.005 },
];

/** How a beech has grown: where the smooth bole forks (fraction of height) and how far its limbs reach. */
export interface BeechForm { fork: number; reach: number }

/**
 * Beech: a straight, smooth, elephant-grey bole with a broad buttressed foot, forking into several steeply rising limbs whose branches
 * fan out into flat, layered sprays under a domed crown. Forest beeches fork high on a long clean bole; open-grown ones low and wide.
 */
export function beechPlan(rng: Rng, height: number, form: BeechForm): TreePlan {
  const fy = form.fork * height;
  const az0 = rng.range(0, TAU);
  const r0 = 0.02 * height + 0.05;
  const trunk = bole(fy, r0, az0, 0.15, rng);
  const top = trunk.pts.length - 1;
  const limbs: Limb[] = [trunk], tips: Tip[] = [];
  const nl = rng.int(4, 6);
  for (let i = 0; i < nl; i++) {
    const az = az0 + ((i + rng.range(-0.3, 0.3)) * TAU) / nl;
    const length = (height - fy) * rng.range(0.7, 0.95) * (0.55 + form.reach * 0.6);
    const from = trunk.pts[top - (i % 2)];
    const pts = growPath(rng, from, pol(az, rng.range(0.85, 1.25)), length, 8, (s) => 0.35 - 1.2 * s * (1.2 - form.reach), 0.5);
    const limb: Limb = { pts, radii: taperRadii(r0 * 0.5, 0.03, pts.length, 0.75), order: 1, parent: trunk };
    limbs.push(limb);
    sprout(rng, limb, { levels: BEECH_LEVELS, order0: 1, tipRadius: { 2: 0.9, 3: 0.85, 4: 0.7 }, tipFrom: 3, limbs, tips });
  }
  deadwood(Math.round(height * 977 + 17), limbs, tips, 0.03, 0.08);
  const flare: Flare = { count: rng.int(5, 7), amp: 0.42, height: 0.85, phase: rng.next() };
  limbs.push(...surfaceRoots(rng, trunk, flare, 0.5 + 2.5 * r0));
  const f = foliageFromTips(rng, tips, 34, trunk.pts[top][1] + 0.5, [0.55, 1]);
  return {
    species: 'beech', height, crownC: f.c, crownR: f.r, trunkRadius: breastRadius(trunk), bark: KIND.beechBark,
    limbs, fronds: [], clusters: f.clusters, cardsPerCluster: 10, cardSize: 0.3, radial: false, foliage: KIND.leaf, trunkSides: [16, 6, 4],
    flare, gnarl: 0.02,
  };
}

const birchLevels = (weep: number): readonly Level[] => [
  { count: 3, start: 0.25, end: 0.9, angle: [0.5, 0.95], length: [0.4, 0.6], segs: 4, bend: -0.9 - 0.6 * weep, wobble: 1.0, radius: 0.55, tipRadius: 0.01 },
  { count: 3, start: 0.2, end: 0.95, angle: [0.45, 0.9], length: [0.4 + 0.25 * weep, 0.65 + 0.35 * weep], segs: 3, bend: -1.2 - 1.6 * weep, wobble: 1.0, radius: 0.6, tipRadius: 0.006 },
];

/** How a birch has grown: how many stems rise from its foot (coppiced or self-sown clumps have two or three) and how much its twigs hang. */
export interface BirchForm { stems: number; weep: number }

/**
 * One slim birch stem from \`base\`, leaning toward \`az\` by \`lean\` (m at the top) and wandering with phase \`ph\`. A lone stem bows over toward its
 * top; the stems of a clump splay out from the foot and then rise.
 */
function birchStem(height: number, r0: number, az: number, lean: number, base: Vec3, ph: number, splay: boolean): Limb {
  const pts: Vec3[] = [], radii: number[] = [];
  for (const y of trunkHeights(height, 9)) {
    const h = Math.max(y, 0) / height;
    const bow = splay ? h * (2 - h) : h * h;
    pts.push([base[0] + Math.sin(az) * lean * bow + 0.16 * Math.sin(h * 5.5 + ph), y, base[2] + Math.cos(az) * lean * bow + 0.16 * Math.sin(h * 4.1 + 1 + ph)]);
    radii.push(lerp(r0, 0.015, Math.pow(h, 0.8)) * (1 + 0.45 * Math.exp(-Math.max(y, 0) / 0.4)));
  }
  return { pts, radii, order: 0 };
}

/**
 * Slim white-barked birch: thin curving stems, ascending limbs with long drooping twigs and light, sparse leaf clusters. A clump has two or
 * three stems splaying out from one foot; a weeping one (old silver birch) has long curtains of hanging twigs.
 */
export function birchPlan(rng: Rng, height: number, form: BirchForm): TreePlan {
  const az0 = rng.range(0, TAU);
  const r0 = (0.0085 * height + 0.05) * (form.stems > 1 ? 0.78 : 1);
  const levels = birchLevels(form.weep);
  const limbs: Limb[] = [], tips: Tip[] = [];
  const stems: Limb[] = [];
  for (let k = 0; k < form.stems; k++) {
    const az = form.stems > 1 ? az0 + (k * TAU) / form.stems + rng.range(-0.4, 0.4) : az0;
    const h = height * (k === 0 ? 1 : rng.range(0.78, 0.95));
    const lean = form.stems > 1 ? h * rng.range(0.1, 0.18) : 0.9;
    const base: Vec3 = form.stems > 1 ? [Math.sin(az) * r0 * 0.7, 0, Math.cos(az) * r0 * 0.7] : [0, 0, 0];
    const stem = birchStem(h, r0 * (k === 0 ? 1 : 0.85), az, lean, base, form.stems > 1 ? rng.range(0, TAU) : 0, form.stems > 1);
    stems.push(stem); limbs.push(stem);
    tips.push({ p: stem.pts[stem.pts.length - 1], r: 0.8, order: 0, limb: stem });
    const nb = form.stems > 1 ? 7 : 10;
    for (let i = 0; i < nb; i++) {
      const t = i / (nb - 1);
      const y = h * lerp(0.36, 0.93, t) + rng.range(-0.25, 0.25);
      const length = Math.max(0.9, lerp(2.8, 0.9, t) * rng.range(0.85, 1.15) * (form.stems > 1 ? 0.8 : 1));
      // Branches on a clump's stems grow away from the other stems, toward the light.
      const yaw = form.stems > 1 ? az + rng.range(-1.6, 1.6) : rng.range(0, TAU);
      const bp = stemAt(stem, y);
      const path = growPath(rng, bp, pol(yaw, lerp(0.35, 0.95, t)), length, 5, (s) => 0.5 - (1.7 + 1.2 * form.weep) * s, 0.35);
      const limb: Limb = { pts: path, radii: taperRadii(0.03 + 0.02 * length, 0.008, path.length), order: 1, parent: stem };
      limbs.push(limb);
      sprout(rng, limb, { levels, order0: 1, tipRadius: { 1: 0.7, 2: 0.6, 3: 0.55 }, tipFrom: 2, limbs, tips });
    }
  }
  deadwood(Math.round(height * 977 + 29 * form.stems), limbs, tips, 0.03, 0.05);
  const flare: Flare = { count: rng.int(4, 6), amp: 0.25, height: 0.35, phase: rng.next() };
  if (form.stems === 1) limbs.push(...surfaceRoots(rng, stems[0], flare, 0.3 + 1.5 * r0));
  const f = foliageFromTips(rng, tips, 8, height * 0.4, [0.6, 1]);
  return {
    species: 'birch', height, crownC: f.c, crownR: f.r, trunkRadius: breastRadius(stems[0]), bark: KIND.birchBark,
    limbs, fronds: [], clusters: f.clusters, cardsPerCluster: 9, cardSize: 0.25, radial: false, foliage: KIND.leaf, trunkSides: [12, 5, 4],
    flare: form.stems === 1 ? flare : { ...flare, amp: 0.12 }, gnarl: 0.02,
  };
}

/** Point on a near-vertical stem at height y. */
function stemAt(stem: Limb, y: number): Vec3 {
  const p = stem.pts;
  let i = 0;
  while (i < p.length - 2 && p[i + 1][1] < y) i++;
  const t = Math.min(Math.max((y - p[i][1]) / Math.max(p[i + 1][1] - p[i][1], 1e-6), 0), 1);
  return [lerp(p[i][0], p[i + 1][0], t), y, lerp(p[i][2], p[i + 1][2], t)];
}

/**
 * How a standing dead tree looks: a conifer trunk snapped at \`broken\` of the height it grew to, with whorls of dead stubs, or a dead broadleaf's
 * bare crown of snapped limbs.
 */
export interface SnagForm { conifer: boolean; broken: number }

/**
 * A standing dead tree (snag) about \`height\` metres tall: bark sloughing off grey weathered wood, no leaves. A conifer snag is a tall trunk
 * snapped part way up with rings of dead branch stubs; a broadleaf snag keeps its bole and a few limbs, most of them broken off.
 */
export function snagPlan(rng: Rng, height: number, form: SnagForm): TreePlan {
  const limbs: Limb[] = [], tips: Tip[] = [];
  let trunk: Limb;
  if (form.conifer) {
    const full = height / form.broken, top = height, r0 = 0.0165 * full + 0.05;
    const pts: Vec3[] = [], radii: number[] = [];
    const az = rng.range(0, TAU), wx = rng.range(0, 10);
    for (const y of trunkHeights(top, 10)) {
      const h = Math.max(y, 0) / full;
      pts.push([Math.sin(az) * 0.5 * h * h + 0.04 * Math.sin(h * 9 + wx), y, Math.cos(az) * 0.5 * h * h + 0.04 * Math.cos(h * 7 + wx)]);
      radii.push((0.02 + (r0 - 0.02) * Math.pow(1 - h, 1.2)) * (1 + 0.35 * Math.exp(-Math.max(y, 0) / 0.45)));
    }
    // The snapped top: splintered, narrower than the wood below.
    radii[radii.length - 1] *= 0.4;
    trunk = { pts, radii, order: 0, dead: true };
    limbs.push(trunk);
    for (let y = 1.5; y < top - 0.6; y += rng.range(0.5, 0.9)) {
      const per = rng.int(2, 4), off = rng.range(0, TAU);
      for (let j = 0; j < per; j++) {
        const len = rng.next() < 0.75 ? rng.range(0.1, 0.35) : rng.range(0.6, 1.6) * (1 - y / full);
        const dir = pol(off + (TAU * j) / per + rng.range(-0.3, 0.3), rng.range(-0.5, 0.1));
        const base = stemAt(trunk, y);
        const p = growPath(rng, base, dir, len, len > 0.5 ? 3 : 1, -0.3, 0.4);
        limbs.push({ pts: p, radii: taperRadii(Math.min(0.015 + 0.02 * len, 0.05), 0.006, p.length), order: 1, dead: true, parent: trunk });
      }
    }
  } else {
    // A dead broadleaf has lost its twigs and the ends of its limbs: it stands about three quarters as tall as it grew.
    const full = height / 0.72, fy = full * 0.3, r0 = 0.022 * full + 0.05, az0 = rng.range(0, TAU);
    trunk = { ...bole(fy, r0, az0, 0.4, rng), dead: true };
    limbs.push(trunk);
    const top = trunk.pts.length - 1;
    for (let i = 0; i < 4; i++) {
      const az = az0 + ((i + rng.range(-0.3, 0.3)) * TAU) / 4;
      const pts = growPath(rng, trunk.pts[top - (i % 2)], pol(az, rng.range(0.7, 1.25)), full * rng.range(0.3, 0.5), 7, (s) => 0.6 - 1.2 * s, 1.2);
      const limb: Limb = { pts, radii: taperRadii(r0 * 0.45, 0.03, pts.length, 0.8), order: 1, parent: trunk };
      limbs.push(limb);
      sprout(rng, limb, { levels: OAK_LEVELS.slice(0, 1), order0: 1, tipRadius: {}, tipFrom: 9, limbs, tips });
      killLimb(limbs, tips, limb, 2, rng.next() < 0.7 ? rng.range(0.3, 0.75) : 1);
    }
  }
  const flare: Flare = { count: rng.int(5, 7), amp: 0.4, height: 0.6, phase: rng.next() };
  const roots = surfaceRoots(rng, trunk, flare, 0.4 + 1.8 * trunk.radii[2]);
  for (const r of roots) r.dead = true;
  limbs.push(...roots);
  const crown = crownOf(limbs.filter((l) => !l.root).flatMap((l) => [l.pts[l.pts.length - 1]]), 0.5);
  // The snapped top of a conifer snag, or a fallen limb of a broadleaf one, lies beside it.
  limbs.push(form.conifer
    ? fallenLog(Math.round(height * 983) + 5, trunk, height / form.broken - height, trunk.radii[trunk.radii.length - 1] / 0.4)
    : fallenLog(Math.round(height * 983) + 9, trunk, 0.45 * height, 0.12 + 0.01 * height));
  return {
    species: 'snag', height, crownC: crown.c, crownR: crown.r, trunkRadius: breastRadius(trunk), bark: KIND.deadWood,
    limbs, fronds: [], clusters: [], cardsPerCluster: 0, cardSize: 0, radial: false, foliage: KIND.leaf, trunkSides: [14, 6, 4],
    flare, gnarl: 0.05,
  };
}

const BUSH_LEVELS: readonly Level[] = [
  { count: 3, start: 0.3, end: 0.9, angle: [0.5, 1.0], length: [0.4, 0.6], segs: 3, bend: 0.1, wobble: 0.4, radius: 0.6, tipRadius: 0.006 },
];

/** Rounded shrub: a fan of thin stems from the ground that fork once, with leaf clusters at the ends and throughout the volume. */
export function bushPlan(rng: Rng, height: number): TreePlan {
  const limbs: Limb[] = [], tips: Tip[] = [];
  const n = 8;
  for (let i = 0; i < n; i++) {
    const az = (i / n) * TAU + rng.range(-0.3, 0.3);
    const pts = growPath(rng, [0, -0.1, 0], pol(az, rng.range(0.6, 1.2)), height * rng.range(0.42, 0.62), 4, (s) => 0.2 - 0.7 * s, 0.4);
    const limb: Limb = { pts, radii: taperRadii(0.028, 0.006, pts.length), order: 1 };
    limbs.push(limb);
    sprout(rng, limb, { levels: BUSH_LEVELS, order0: 1, tipRadius: { 1: 0.5, 2: 0.4 }, tipFrom: 1, limbs, tips });
  }
  const f = foliageFromTips(rng, tips, 9, 0.25, [0.5, 1]);
  return {
    species: 'bush', height, crownC: f.c, crownR: f.r, trunkRadius: 0.03, bark: KIND.bark,
    limbs, fronds: [], clusters: f.clusters, cardsPerCluster: 6, cardSize: 0.17, radial: false, foliage: KIND.leaf, trunkSides: [4, 4, 3],
  };
}

/** Juniper-like conifer shrub: a star of upright needle fronds around a few stubby stems. */
export function juniperPlan(rng: Rng, height: number): TreePlan {
  const limbs: Limb[] = [], fronds: Frond[] = [];
  for (let i = 0; i < 3; i++) {
    const pts = growPath(rng, [0, -0.1, 0], pol(rng.range(0, TAU), 1.3), height * 0.45, 3, 0.2, 0.3);
    limbs.push({ pts, radii: taperRadii(0.03, 0.012, pts.length), order: 1 });
  }
  const nf = 20;
  for (let i = 0; i < nf; i++) {
    const t = norm(pol((i * 2.399963) % TAU, lerp(0.25, 1.25, ((i * 7) % nf) / nf)));
    const flen = height * rng.range(0.65, 0.95);
    fronds.push({ c: add([0, 0.03, 0], mul(t, flen * 0.5)), t, len: flen, width: flen * 0.7, branch: i });
  }
  const R = height * 0.5;
  return {
    species: 'juniper', height, crownC: [0, height * 0.5, 0], crownR: [R, height * 0.55, R], trunkRadius: 0.03, bark: KIND.bark,
    limbs, fronds, clusters: [], cardsPerCluster: 0, cardSize: 0, radial: false, foliage: KIND.needle, trunkSides: [4, 4, 3],
  };
}

`,iS=`import type { TerrainData, TrackData } from '../../contracts';
import { hash2, smoothstep } from './noise';
import { placementSeed, regionSeed } from './placement';
import { PlacementRules, type Canopy } from './placementRules';
import { COARSE, buildRegion } from './region';
import { TerrainFields } from './terrainFields';
import { VARIANTS_OF, VARIANT_DEFS, variantPlan } from './variants';

/** Far-field canopy cards: one billboard per clump of trees, 32 bytes each (layout mirrored by veg_far.wgsl). */
export const FAR_CARD_BYTES = 32;
export const FAR_CARD_WORDS = FAR_CARD_BYTES / 4;
/** Side of a card's cell (m): a card stands for the canopy of the trees in this much ground. */
export const FAR_CELL = 12;
const SUBCELLS = COARSE / FAR_CELL;
/** Tree density (per 3 m cell) below which a cell has no card, and above which it always has one. */
const DENSITY_MIN = 0.03;
const DENSITY_FULL = 0.2;

export interface FarOptions {
  /** Most cards placed (nearest the racing line first). */
  cap: number;
  /** Cards are placed out to this distance from the racing line (m). */
  radius: number;
  /** Cells whose approximate distance to the racing line exceeds this have no real trees; their cards show from \`uncoveredNear\` on. */
  coveredRing: number;
  /** Camera distance (m) where a card over ground with no real trees shows; cards over covered ground show from the live tree draw distance (near 0). */
  uncoveredNear: number;
}

export interface FarForest {
  count: number;
  /** FAR_CARD_WORDS words per card: x, ground y, z, height, width (floats), tint (u32), near distance (f32, 0 = the tree draw distance), info (u32). */
  words: Uint32Array;
  /** Cards drawn from \`uncoveredNear\` (no real tree behind them). */
  uncovered: number;
}

/** Species class stored in a card: 0 spruce, 1 pine, 2 oak and beech (round broadleaf crowns), 3 birch. */
export function farSpecies(variant: number): number {
  const species = variantPlan(variant)?.species;
  return species === 'spruce' ? 0 : species === 'pine' ? 1 : species === 'birch' ? 3 : 2;
}

/**
 * WGSL defines TONE0..TONE3 (leaf albedo rgb and translucency of spruce, pine, oak, birch): the mean of the species' variants, so the cards
 * follow the tree table instead of repeating its numbers.
 */
export function farToneDefines(): Record<string, string> {
  const out: Record<string, string> = {};
  const groups: readonly (readonly number[])[] = [VARIANTS_OF.spruce, VARIANTS_OF.pine, [...VARIANTS_OF.oak, ...VARIANTS_OF.beech], VARIANTS_OF.birch];
  groups.forEach((variants, k) => {
    const mean = (f: (d: (typeof VARIANT_DEFS)[number]) => number): number => variants.reduce((t, v) => t + f(VARIANT_DEFS[v]), 0) / variants.length;
    out[\`TONE\${k}\`] = [mean((d) => d.tone[0]), mean((d) => d.tone[1]), mean((d) => d.tone[2]), mean((d) => d.translucency)].map((v) => v.toFixed(4)).join(', ');
  });
  return out;
}

/** info word: species (3 bits) | lobes - 1 (2 bits) | 16-bit random for the lobe layout. */
export const packFarInfo = (species: number, lobes: number, rnd: number): number => (species | ((lobes - 1) << 3) | ((rnd & 0xffff) << 5)) >>> 0;

/**
 * Canopy cards for the ground the real trees do not reach: the same stand, soil, slope and altitude fields as the tree placement
 * sampled on a 12 m grid, one card per cell that holds enough trees, walked from the racing line outwards.
 */
export function placeFarForest(terrain: TerrainData, track: TrackData | null, o: FarOptions): FarForest {
  const fields = new TerrainFields(terrain);
  const rules = new PlacementRules(fields, placementSeed(terrain));
  const e = (terrain.resolution - 1) * terrain.cellSize;
  const [ox, oz] = terrain.origin;
  const region = buildRegion(track, [ox + e / 2, oz + e / 2], o.radius, [ox, oz, ox + e, oz + e], regionSeed(terrain));
  const words = new Uint32Array(o.cap * FAR_CARD_WORDS);
  const f32 = new Float32Array(words.buffer);
  const c: Canopy = { density: 0, variant: 0, scale: 1, tint: 0 };
  let count = 0, uncovered = 0;
  for (const cell of region.order) {
    if (count >= o.cap) break;
    const ci = region.i0 + (cell % region.nx), cj = region.j0 + Math.floor(cell / region.nx);
    const ring = region.dist[cell];
    const far = ring > o.coveredRing;
    for (let s = 0; s < SUBCELLS * SUBCELLS && count < o.cap; s++) {
      const fx = ci * SUBCELLS + (s % SUBCELLS), fz = cj * SUBCELLS + Math.floor(s / SUBCELLS);
      const x = (fx + 0.15 + 0.7 * hash2(fx, fz, 31)) * FAR_CELL, z = (fz + 0.15 + 0.7 * hash2(fx, fz, 32)) * FAR_CELL;
      if (!fields.inside(x, z, 6)) continue;
      if (track?.parkMap && Math.hypot(x, z) < track.parkMap.radius + 20) continue;
      rules.canopy(fx, fz, x, z, c);
      if (c.density < DENSITY_MIN) continue;
      const keep = smoothstep(DENSITY_MIN, DENSITY_FULL, c.density);
      if (hash2(fx, fz, 33) >= keep) continue;
      const lobes = 1 + (c.density > 0.12 ? 1 : 0) + (c.density > 0.35 ? 1 : 0);
      const def = VARIANT_DEFS[c.variant];
      const i = count++ * FAR_CARD_WORDS;
      f32[i] = x; f32[i + 1] = fields.height(x, z); f32[i + 2] = z;
      f32[i + 3] = def.height * c.scale * (variantPlan(c.variant)?.species === 'oak' ? 0.85 : 1);
      f32[i + 4] = FAR_CELL * (1.05 + 0.4 * hash2(fx, fz, 34));
      words[i + 5] = c.tint;
      f32[i + 6] = far ? o.uncoveredNear : 0;
      words[i + 7] = packFarInfo(farSpecies(c.variant), lobes, Math.floor(hash2(fx, fz, 35) * 65536));
      if (far) uncovered++;
    }
  }
  return { count, words: words.subarray(0, count * FAR_CARD_WORDS), uncovered };
}
`,aS=`import type { RenderContext } from '../contracts';
import type { PackedInstances } from './instanceData';
import { ARGS_BYTES, ARGS_WORDS, type TreeAssets } from './treeAssets';
import { DRAW_COUNT, LOD_COUNT, VARIANT_COUNT, isRockVariant } from './variants';

const COUNT_BYTES = DRAW_COUNT * 4;
const SAMPLE_INTERVAL = 30;

export interface TreeCounters {
  /** Instances that survived culling in the last sampled frame, per LOD, for trees and bushes and for rocks. */
  plantLod: [number, number, number];
  rockLod: [number, number, number];
}

/**
 * GPU-driven trees, bushes and rocks for one instance set: encodePre culls every slot against the frustum and the pixel-size limit,
 * picks a LOD and appends into per-(variant, LOD) lists whose counts become indirect draw arguments (no readback);
 * encodeGBuffer issues one indexed indirect draw per non-empty (variant, LOD).
 */
export class TreeSystem {
  readonly slots: number;
  readonly instanceBytes: number;
  readonly bufferBytes: number;
  readonly counts: TreeCounters = { plantLod: [0, 0, 0], rockLod: [0, 0, 0] };
  /** True once a counter readback has completed. */
  sampled = false;
  private readonly instances: GPUBuffer;
  /** One bit per slot: the tree has GI proxies (tree.wgsl crownAo). */
  private readonly proxied: GPUBuffer;
  private readonly variantTable: GPUBuffer;
  private readonly counters: GPUBuffer;
  private readonly visible: GPUBuffer;
  private readonly args: GPUBuffer;
  private readonly staging: GPUBuffer | null;
  private readonly cullGroup: GPUBindGroup;
  private readonly finalizeGroup: GPUBindGroup;
  private readonly draws: { k: number; group: GPUBindGroup }[] = [];
  private copyQueued = false;
  private mapping = false;
  private sinceSample = 0;

  constructor(rc: RenderContext, private readonly assets: TreeAssets, params: GPUBuffer, packed: PackedInstances, readback: boolean) {
    const dev = rc.device;
    const S = GPUBufferUsage.STORAGE;
    this.slots = packed.slots;
    this.instanceBytes = packed.instances.byteLength;
    const visibleBytes = Math.max(packed.slots * LOD_COUNT * 4, 256);
    this.bufferBytes = this.instanceBytes + packed.variants.byteLength + visibleBytes + COUNT_BYTES + ARGS_BYTES;
    this.instances = dev.createBuffer({ label: 'tree-instances', size: this.instanceBytes, usage: S | GPUBufferUsage.COPY_DST });
    dev.queue.writeBuffer(this.instances, 0, packed.instances);
    this.proxied = dev.createBuffer({ label: 'tree-proxied', size: Math.max(16, Math.ceil(packed.slots / 32) * 4), usage: S | GPUBufferUsage.COPY_DST });
    this.variantTable = dev.createBuffer({ label: 'tree-variants', size: packed.variants.byteLength, usage: S | GPUBufferUsage.COPY_DST });
    dev.queue.writeBuffer(this.variantTable, 0, packed.variants);
    this.counters = dev.createBuffer({ label: 'tree-counts', size: COUNT_BYTES, usage: S | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST });
    this.visible = dev.createBuffer({ label: 'tree-visible', size: visibleBytes, usage: S });
    this.args = dev.createBuffer({ label: 'tree-args', size: ARGS_BYTES, usage: S | GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST });
    dev.queue.writeBuffer(this.args, 0, assets.argsTemplate);
    this.staging = readback ? dev.createBuffer({ label: 'tree-count-readback', size: COUNT_BYTES, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }) : null;

    const entry = (binding: number, buffer: GPUBuffer): GPUBindGroupEntry => ({ binding, resource: { buffer } });
    this.cullGroup = dev.createBindGroup({
      label: 'tree-cull',
      layout: assets.cullLayout,
      entries: [entry(0, params), entry(1, this.instances), entry(2, this.variantTable), entry(3, this.counters), entry(4, this.visible)],
    });
    this.finalizeGroup = dev.createBindGroup({
      label: 'tree-finalize',
      layout: assets.finalizeLayout,
      entries: [entry(0, params), entry(1, this.counters), entry(2, this.args)],
    });
    const addDraw = (v: number, lod: number): void => {
      const k = v * LOD_COUNT + lod;
      this.draws.push({
        k,
        group: dev.createBindGroup({
          label: \`tree-draw-\${k}\`,
          layout: assets.drawLayout,
          entries: [
            entry(0, params), entry(1, this.instances),
            { binding: 2, resource: { buffer: this.visible, offset: 4 * (lod * packed.slots + packed.first[v]) } },
            entry(3, this.variantTable),
            { binding: 4, resource: assets.atlasView },
            { binding: 5, resource: assets.atlasDataView },
            { binding: 6, resource: assets.barkNoiseView },
            { binding: 7, resource: assets.leafSampler },
            { binding: 8, resource: assets.barkColourView },
            { binding: 9, resource: assets.barkSurfaceView },
            { binding: 10, resource: assets.barkSampler },
            entry(11, this.proxied),
          ],
        }),
      });
    };
    // Plants grouped by LOD so a pipeline is set once per LOD, rocks last.
    for (let lod = 0; lod < LOD_COUNT; lod++) for (let v = 0; v < VARIANT_COUNT; v++) if (!isRockVariant(v) && packed.count[v] > 0) addDraw(v, lod);
    for (let v = 0; v < VARIANT_COUNT; v++) if (isRockVariant(v) && packed.count[v] > 0) for (let lod = 0; lod < LOD_COUNT; lod++) addDraw(v, lod);
  }

  /** Marks which slots hold a tree with GI proxies: one bit per slot (tree.wgsl crownAo). */
  setProxied(rc: RenderContext, bits: Uint32Array): void {
    rc.device.queue.writeBuffer(this.proxied, 0, bits.buffer, bits.byteOffset, Math.min(bits.byteLength, this.proxied.size));
  }

  /** Call from update(): finishes the counter readback started by an earlier frame's encodePre, once that frame was submitted. */
  pollReadback(): void {
    const staging = this.staging;
    if (!staging || !this.copyQueued || this.mapping) return;
    this.copyQueued = false;
    this.mapping = true;
    staging.mapAsync(GPUMapMode.READ).then(() => {
      const c = new Uint32Array(staging.getMappedRange().slice(0));
      staging.unmap();
      this.counts.plantLod.fill(0);
      this.counts.rockLod.fill(0);
      for (let k = 0; k < DRAW_COUNT; k++) {
        const into = isRockVariant(Math.floor(k / LOD_COUNT)) ? this.counts.rockLod : this.counts.plantLod;
        into[k % LOD_COUNT] += c[k];
      }
      this.sampled = true;
      this.mapping = false;
    }, () => { this.mapping = false; });
  }

  encodePre(enc: GPUCommandEncoder, rc: RenderContext): void {
    if (this.slots === 0) return;
    this.clearCounters(enc);
    const pass = enc.beginComputePass({ label: 'tree-cull' });
    this.encodeCull(pass, rc);
    pass.end();
    this.copyCounters(enc);
  }

  /** Clear before beginning the standalone or shared vegetation compute pass. */
  clearCounters(enc: GPUCommandEncoder): void {
    if (this.slots !== 0) enc.clearBuffer(this.counters);
  }

  /** The original two dispatches, also usable in the shared vegetation compute pass. */
  encodeCull(pass: GPUComputePassEncoder, rc: RenderContext): void {
    if (this.slots === 0) return;
    pass.setBindGroup(0, rc.frame.group);
    pass.setBindGroup(1, rc.world.group);
    pass.setPipeline(this.assets.cullPipe);
    pass.setBindGroup(2, this.cullGroup);
    pass.dispatchWorkgroups(Math.ceil(this.slots / 64));
    pass.setPipeline(this.assets.finalizePipe);
    pass.setBindGroup(2, this.finalizeGroup);
    pass.dispatchWorkgroups(1);
  }

  /** Optional dev readback; call after the compute pass has ended. */
  copyCounters(enc: GPUCommandEncoder): void {
    if (this.slots === 0) return;
    if (this.staging && !this.copyQueued && !this.mapping && ++this.sinceSample >= SAMPLE_INTERVAL) {
      this.sinceSample = 0;
      enc.copyBufferToBuffer(this.counters, 0, this.staging, 0, COUNT_BYTES);
      this.copyQueued = true;
    }
  }

  encodeGBuffer(pass: GPURenderPassEncoder | GPURenderBundleEncoder): void {
    if (this.slots === 0) return;
    pass.setVertexBuffer(0, this.assets.vertexBuffer);
    pass.setIndexBuffer(this.assets.indexBuffer, 'uint32');
    let current: GPURenderPipeline | null = null;
    for (const d of this.draws) {
      const next = this.assets.isRockDraw(d.k) ? this.assets.rockPipe : this.assets.treePipes[d.k % LOD_COUNT];
      if (next !== current) {
        pass.setPipeline(next);
        current = next;
      }
      pass.setBindGroup(2, d.group);
      pass.drawIndexedIndirect(this.args, d.k * ARGS_WORDS * 4);
    }
  }

  destroy(): void {
    for (const buf of [this.proxied, this.instances, this.variantTable, this.counters, this.visible, this.args, this.staging]) buf?.destroy();
  }
}
`,oS=`import type { Vec3 } from '../../contracts';
import { Rng } from '../../world/track/rng';
import type { MeshData } from './meshBuilder';
import { rockAssets } from './rockGen';
import { runSliced, runSync, type Steps } from './slices';
import { buildTreeLods } from './treeGen';
import { beechPlan, birchPlan, bushPlan, juniperPlan, oakPlan, snagPlan } from './treePlanBroad';
import { densify, pinePlan, sprucePlan, type TreePlan } from './treePlan';

export const LOD_COUNT = 3;
export const VARIANT_COUNT = 22;
export const DRAW_COUNT = VARIANT_COUNT * LOD_COUNT;
export const FIRST_ROCK = 18;
export const isRockVariant = (v: number): boolean => VARIANT_DEFS[v].group === 'rock';

export type VariantGroup = 'tree' | 'bush' | 'rock';

export interface VariantDef {
  name: string;
  group: VariantGroup;
  /** Height parameter of the plan in metres at instance scale 1; squat crowns (oaks) build to about 0.8 of it. */
  height: number;
  /** Minimum spacing radius (m) for Poisson placement at scale 1; a pair keeps half the sum of both. */
  spacing: number;
  seed: number;
  plan: ((rng: Rng) => TreePlan) | null;
  /** Rock shape index, -1 for plants. */
  rock: number;
  swayHz: number;
  /** Lateral crown displacement as a fraction of height per m/s of wind. */
  swayStrength: number;
  /** Leaf-card wobble amplitude in metres. */
  flutter: number;
  /** Leaf (or base rock) albedo of the unpainted green: the atlas multiplies it by a shade of 0.5-1 and a hue ramp, so painted leaves land at 0.04-0.15 per channel (conifer needles at 0.04-0.08). */
  tone: Vec3;
  translucency: number;
  /** LOD0 and LOD1 hand-over distances as multiples of the bounding radius. */
  lodRatio: [number, number];
}

// \`lod\` is the near and mid LOD hand-over as multiples of the bounding radius. The oaks use less than the default: their wide crowns give
// them a big radius, so they hand over at the distances they did with narrower crowns (near about 40-50 m, mid about 135-185 m at scale 1).
const tree = (name: string, height: number, spacing: number, seed: number, plan: (rng: Rng) => TreePlan, sway: [number, number, number], tone: Vec3, translucency: number, lod: [number, number] = [4.5, 16]): VariantDef => ({
  name, group: 'tree', height, spacing, seed, plan, rock: -1, swayHz: sway[0], swayStrength: sway[1], flutter: sway[2], tone, translucency, lodRatio: lod,
});
const bush = (name: string, height: number, spacing: number, seed: number, plan: (rng: Rng) => TreePlan, sway: [number, number, number], tone: Vec3, translucency: number): VariantDef => ({
  ...tree(name, height, spacing, seed, plan, sway, tone, translucency), group: 'bush', lodRatio: [28, 80],
});
const rock = (name: string, shape: number, tone: Vec3): VariantDef => ({
  name, group: 'rock', height: 1, spacing: 0.9, seed: shape, plan: null, rock: shape, swayHz: 0, swayStrength: 0, flutter: 0, tone, translucency: 0, lodRatio: [30, 90],
});

/**
 * Plants first, then rocks; the order is the shader's variant index. Every tree species comes in growth forms (VARIANTS_OF lists them as
 * open-grown, forest-grown, then a character form): open-grown trees keep low limbs and broad crowns, forest-grown ones a long bare bole
 * under a high, narrow crown, and the third is the odd one out (an old drooping spruce, a crooked pine, a stag-headed veteran oak, a
 * weeping birch; for birch the open-grown form is a clump of stems). Snags are standing dead trees. Variants 0-7 keep the species they had
 * before the growth forms were added (spruce, spruce, pine, oak, oak, birch, bush, juniper), because the theme park plants them by index.
 */
export const VARIANT_DEFS: readonly VariantDef[] = [
  tree('spruce open', 18, 3.2, 0x5a01, (r) => sprucePlan(r, 18, { reach: 0.31, crownBase: 0.1, deadBelow: false, droop: 0.5, lean: 0.35 }), [0.45, 0.003, 0.03], [0.03, 0.075, 0.043], 0.3),
  tree('spruce forest', 22, 3.2, 0x5a02, (r) => sprucePlan(r, 22, { reach: 0.22, crownBase: 0.38, deadBelow: true, droop: 0.3, lean: 0.25 }), [0.42, 0.003, 0.03], [0.032, 0.079, 0.046], 0.3),
  tree('pine forest', 19.5, 4.2, 0x5a0a, (r) => pinePlan(r, 19.5, { crownStart: 0.6, limbs: 14, spread: 0.9, lean: 0.9, wobble: 0.1, stubs: 7 }), [0.36, 0.0042, 0.03], [0.042, 0.088, 0.046], 0.3),
  tree('oak open', 20, 5.2, 0x5a04, (r) => oakPlan(r, 20, { fork: 0.17, limbs: [4, 6], reach: 1, upright: 0.1, trunk: 1, dead: 0.04, gnarl: 0.07 }), [0.33, 0.0028, 0.04], [0.058, 0.12, 0.038], 0.45, [3.0, 10.8]),
  tree('oak forest', 25, 5.2, 0x5a05, (r) => oakPlan(r, 25, { fork: 0.42, limbs: [4, 5], reach: 0.55, upright: 0.5, trunk: 0.85, dead: 0.12, gnarl: 0.05 }), [0.31, 0.0028, 0.04], [0.064, 0.126, 0.04], 0.45, [3.8, 13.5]),
  tree('birch', 16, 3.6, 0x5a06, (r) => birchPlan(r, 16, { stems: 1, weep: 0 }), [0.65, 0.006, 0.04], [0.07, 0.135, 0.044], 0.5),
  bush('bush', 1.6, 1.7, 0x5a07, (r) => bushPlan(r, 1.6), [1.1, 0.004, 0.04], [0.052, 0.105, 0.036], 0.45),
  bush('juniper', 1.3, 1.6, 0x5a08, (r) => juniperPlan(r, 1.3), [0.9, 0.004, 0.03], [0.036, 0.078, 0.05], 0.3),
  tree('spruce old', 21, 3.4, 0x5a09, (r) => sprucePlan(r, 21, { reach: 0.28, crownBase: 0.24, deadBelow: true, droop: 1, lean: 0.55 }), [0.42, 0.003, 0.03], [0.028, 0.07, 0.044], 0.3),
  tree('pine open', 17, 4.2, 0x5a03, (r) => pinePlan(r, 17, { crownStart: 0.4, limbs: 20, spread: 1.25, lean: 1.4, wobble: 0.22, stubs: 3 }), [0.38, 0.0042, 0.03], [0.04, 0.085, 0.046], 0.3),
  tree('pine crooked', 18.5, 4.2, 0x5a0b, (r) => pinePlan(r, 18.5, { crownStart: 0.55, limbs: 16, spread: 1.05, lean: 3.2, wobble: 0.45, stubs: 4 }), [0.38, 0.0045, 0.03], [0.038, 0.082, 0.046], 0.3),
  tree('oak veteran', 16, 5.4, 0x5a0c, (r) => oakPlan(r, 16, { fork: 0.2, limbs: [4, 5], reach: 1, upright: 0.25, trunk: 1.55, dead: 0.4, gnarl: 0.12 }), [0.3, 0.0024, 0.04], [0.06, 0.118, 0.038], 0.45, [3.2, 11.4]),
  tree('birch clump', 15, 3.6, 0x5a0d, (r) => birchPlan(r, 15, { stems: 3, weep: 0.2 }), [0.68, 0.006, 0.04], [0.068, 0.132, 0.046], 0.5),
  tree('birch weeping', 17, 3.8, 0x5a0e, (r) => birchPlan(r, 17, { stems: 1, weep: 1 }), [0.62, 0.006, 0.04], [0.072, 0.138, 0.044], 0.5),
  tree('beech open', 22, 5.4, 0x5a0f, (r) => beechPlan(r, 22, { fork: 0.22, reach: 0.9 }), [0.32, 0.0026, 0.04], [0.062, 0.13, 0.036], 0.5),
  tree('beech forest', 30, 5.2, 0x5a10, (r) => beechPlan(r, 30, { fork: 0.46, reach: 0.5 }), [0.3, 0.0026, 0.04], [0.058, 0.126, 0.036], 0.5),
  tree('snag conifer', 14, 3.2, 0x5a11, (r) => snagPlan(r, 14, { conifer: true, broken: 0.68 }), [0.3, 0.0012, 0], [0.05, 0.05, 0.05], 0),
  tree('snag broadleaf', 10, 4.2, 0x5a12, (r) => snagPlan(r, 10, { conifer: false, broken: 1 }), [0.3, 0.0015, 0], [0.05, 0.05, 0.05], 0),
  rock('angular rock', 0, [0.3, 0.29, 0.27]),
  rock('round boulder', 1, [0.27, 0.26, 0.24]),
  rock('flat slab', 2, [0.34, 0.31, 0.27]),
  rock('tall chunk', 3, [0.28, 0.27, 0.26]),
];

export const VARIANTS_OF = {
  spruce: [0, 1, 8], pine: [9, 2, 10], oak: [3, 4, 11], birch: [12, 5, 13], beech: [14, 15], snag: [16, 17], bush: [6], juniper: [7], rock: [18, 19, 20, 21],
} as const;

const plans: (TreePlan | null)[] = [];

/** The skeleton of a plant variant (memoised; deterministic per variant), null for rocks. */
export function variantPlan(v: number): TreePlan | null {
  if (plans[v] === undefined) {
    const def = VARIANT_DEFS[v];
    plans[v] = def.plan ? def.plan(new Rng(def.seed)) : null;
  }
  return plans[v];
}

/**
 * Numbers the layout reads (m at scale 1): horizontal crown radius, the crown top placement scales by, the top of the foliage, and the
 * breast-height trunk radius placement scales by.
 */
export interface LayoutCrown { crown: number; top: number; crownTop: number; trunk: number }

// The crowns as they were when the race worlds' layout was settled (2026-10-11). Placement keep-outs, scale limits and trunk collider
// heights read these instead of the drawn crown, so a crown can be reshaped without moving a tree or a collider. Change one only when
// the layout itself is meant to change, and list it with the gameplay changes. The three oaks were updated the same day for their
// thicker trunks and wider, low-forked crowns, and the three spruces for their wider crowns (reach 0.31 / 0.22 / 0.28, open-grown Norway
// spruce being about 0.65-0.7 as wide as tall; docs/history/2026-10-session.md lists what moved).
const LAYOUT_CROWNS: Readonly<Record<string, LayoutCrown>> = {
  'spruce open': { crown: 5.859, top: 18, crownTop: 19.080000000000002, trunk: 0.30883139247709107 },
  'spruce forest': { crown: 5.082, top: 22, crownTop: 23.32, trunk: 0.377444239994894 },
  'pine forest': { crown: 4.393045984979251, top: 19.5, crownTop: 21.20899818302396, trunk: 0.3283538095866827 },
  'oak open': { crown: 12.502572382502073, top: 17.078635186435562, crownTop: 17.878635186435563, trunk: 0.5620898659787166 },
  'oak forest': { crown: 6.641321776589879, top: 20.117748555532, crownTop: 20.917748555532, trunk: 0.6493176001043693 },
  'birch': { crown: 3.084935198612871, top: 16, crownTop: 16.8, trunk: 0.16848571985520766 },
  'bush': { crown: 1.4690340919623504, top: 0.8350295910028345, crownTop: 1.6350295910028345, trunk: 0.03 },
  'juniper': { crown: 0.65, top: 1.3, crownTop: 1.3650000000000002, trunk: 0.03 },
  'spruce old': { crown: 6.174000000000001, top: 21, crownTop: 22.26, trunk: 0.3602933508782565 },
  'pine open': { crown: 6.285019408290031, top: 17, crownTop: 19.191156080352815, trunk: 0.2879465857800804 },
  'pine crooked': { crown: 4.9702813842218525, top: 18.5, crownTop: 20.15712573015106, trunk: 0.3121957574180043 },
  'oak veteran': { crown: 7.832299420369366, top: 14.45869608727261, crownTop: 15.258696087272611, trunk: 0.7058441811910107 },
  'birch clump': { crown: 3.91888379796249, top: 15, crownTop: 15.8, trunk: 0.12497559580035739 },
  'birch weeping': { crown: 3.1643255418795455, top: 17, crownTop: 17.8, trunk: 0.17733318163026734 },
  'beech open': { crown: 10.793974798978384, top: 24.521950810134815, crownTop: 25.321950810134815, trunk: 0.47127364135457145 },
  'beech forest': { crown: 8.220815614264287, top: 26.422206824240074, crownTop: 27.222206824240075, trunk: 0.6704354070159076 },
  'snag conifer': { crown: 1.3487823613608731, top: 13.7, crownTop: 14.5, trunk: 0.37281647716976973 },
  'snag broadleaf': { crown: 3.0837791071140916, top: 9.774308380852892, crownTop: 10.574308380852893, trunk: 0.3363964276945343 },
};

/** The layout's crown numbers of a plant variant, null for rocks. */
export function layoutCrown(v: number): LayoutCrown | null {
  return VARIANT_DEFS[v].plan ? LAYOUT_CROWNS[VARIANT_DEFS[v].name] ?? null : null;
}

export interface VariantAsset {
  def: VariantDef;
  lods: [MeshData, MeshData, MeshData];
  /** Mesh extent above its origin (top of the tallest LOD0 vertex). */
  height: number;
  /** Bounding sphere centre height (about the vertical axis through the origin) and radius, covering every LOD. */
  centreY: number;
  radius: number;
}

function bounds(lods: readonly MeshData[]): { height: number; centreY: number; radius: number } {
  let y0 = Infinity, y1 = -Infinity;
  for (const m of lods) for (let i = 0; i < m.vertexCount; i++) { y0 = Math.min(y0, m.pos[i * 3 + 1]); y1 = Math.max(y1, m.pos[i * 3 + 1]); }
  const cy = (y0 + y1) / 2;
  let r = 0;
  for (const m of lods) for (let i = 0; i < m.vertexCount; i++) r = Math.max(r, Math.hypot(m.pos[i * 3], m.pos[i * 3 + 1] - cy, m.pos[i * 3 + 2]));
  return { height: y1, centreY: cy, radius: r };
}

/** The three LOD meshes of a plant variant at the budgeted tiers (memoised: placement's park checks and the ray-traced canopy fit read them too). */
const lodCache: ([MeshData, MeshData, MeshData] | undefined)[] = [];
export function variantLods(v: number): [MeshData, MeshData, MeshData] {
  return (lodCache[v] ??= buildTreeLods(variantPlan(v) as TreePlan, VARIANT_DEFS[v].seed));
}

/** Hands meshes already built elsewhere (the disk cache, the worker threads) to variantLods, so they are not built again. */
export function seedVariantLods(assets: readonly VariantAsset[]): void {
  assets.forEach((asset, v) => { if (asset.def.plan && asset.lods.length === 3) lodCache[v] ??= asset.lods as [MeshData, MeshData, MeshData]; });
}

/** \`dense\` builds the extreme tier's fuller crowns (treeGen.ts FoliageOptions, densify()); the plans, and so placement and colliders, are the same. */
function* variantSteps(dense = false, prebuilt?: readonly (VariantAsset | null)[]): Steps<VariantAsset[]> {
  const rocks = rockAssets();
  yield;
  const out: VariantAsset[] = [];
  for (let v = 0; v < VARIANT_DEFS.length; v++) {
    const def = VARIANT_DEFS[v];
    if (def.rock >= 0) {
      const r = rocks[def.rock];
      out.push({ def, lods: r.lods, height: r.height, centreY: r.centreY, radius: r.radius });
    } else out.push(prebuilt?.[v] ?? treeAsset(v, dense));
    yield;
  }
  return out;
}

/** One tree variant's three LOD meshes and bounding sphere (the tree build workers call this for their share, treeBuildPool.ts). */
export function treeAsset(v: number, dense = false): VariantAsset {
  const def = VARIANT_DEFS[v], plan = variantPlan(v) as TreePlan;
  const lods = dense ? buildTreeLods(densify(plan), def.seed, undefined, { dense }) : variantLods(v);
  return { def, lods, ...bounds(lods) };
}

/** Generates every variant's three LOD meshes and bounding spheres (about 0.4 s of CPU). */
export function buildVariantAssets(dense = false): VariantAsset[] {
  return runSync(variantSteps(dense));
}

/** The same assets generated in slices with an event-loop yield between them (see slices.ts); \`prebuilt\` holds trees already built elsewhere, by variant. */
export function buildVariantAssetsSliced(budgetMs = 8, yieldFn?: () => Promise<void>, dense = false, prebuilt?: readonly (VariantAsset | null)[]): Promise<VariantAsset[]> {
  return runSliced(variantSteps(dense, prebuilt), budgetMs, yieldFn);
}
`,sS=/(?:^|[;}\n])[ \t]*(import|export)\s+(type\s+)?([\w$*{}\s,]*?)\s*from\s*['"]([^'"\n]+)['"]/g,cS=/(?:^|[;}\n])[ \t]*import\s*['"]([^'"\n]+)['"]/g,lS=/\bimport\s*\(\s*(['"]?)([^'")\n]*)\1\s*\)/g,uS=/\bnew\s+URL\s*\(\s*['"]([^'"\n]+)['"]\s*,\s*import\.meta\.url\s*\)/g;function dS(e){let t=``;for(let n=0;n<e.length;n++){let r=e[n],i=e[n+1];if(r===`/`&&i===`/`){for(;n<e.length&&e[n]!==`
`;)n++;t+=`
`;continue}if(r===`/`&&i===`*`){let r=e.indexOf(`*/`,n+2),i=r<0?e.length:r+2;t+=e.slice(n,i).replace(/[^\n]/g,` `),n=i-1;continue}if(r===`"`||r===`'`||r==="`"){let i=n+1;for(;i<e.length&&e[i]!==r&&(e[i]===`\\`&&i++,r==="`"||e[i]!==`
`);)i++;t+=e.slice(n,i+1),n=i;continue}t+=r}return t}function fS(e){let t=[];for(let n of e.matchAll(sS)){let e=n[3].trim(),r=[],i=!!n[2];if(n[1]===`import`&&!i){let t=/\{([^}]*)\}/.exec(e),n=e.replace(/\{[^}]*\}/,``).split(`,`).map(e=>e.trim()).filter(Boolean);for(let e of n)r.push(e.replace(/^\*\s+as\s+/,``));let a=t?t[1].split(`,`).map(e=>e.trim()).filter(Boolean):[];for(let e of a)e.startsWith(`type `)||r.push(e.split(/\s+as\s+/).pop().trim());i=n.length===0&&a.length>0&&a.every(e=>e.startsWith(`type `))}else if(n[1]===`export`&&!i){let t=/\{([^}]*)\}/.exec(e);if(t){let e=t[1].split(`,`).map(e=>e.trim()).filter(Boolean);i=e.length>0&&e.every(e=>e.startsWith(`type `))}}t.push({spec:n[4],names:r,typeOnly:i})}for(let n of e.matchAll(cS))t.push({spec:n[1],names:[],typeOnly:!1});for(let n of e.matchAll(lS))t.push({spec:n[1]?n[2]:`<computed ${n[2].trim()}>`,names:[],typeOnly:!1});for(let n of e.matchAll(uS))t.push({spec:n[1],names:[],typeOnly:!1});for(let n of pS(e))t.push({spec:n,names:[],typeOnly:!1});return t}function pS(e){let t=[];for(let n of e.matchAll(/\bimport\.meta\.glob\s*(?:<[^>]*>)?\s*\(/g)){let r=1,i=n.index+n[0].length;for(;i<e.length&&r;i++)r+=e[i]===`(`?1:e[i]===`)`?-1:0;let a=e.slice(n.index+n[0].length,i-1),o=/^\s*(\[[^\]]*\]|'[^']*'|"[^"]*")/.exec(a),s=o?[...o[1].matchAll(/'([^']*)'|"([^"]*)"/g)].map(e=>e[1]??e[2]):[];if(!o||!s.length||/\$\{/.test(o[1])){t.push(`<import.meta.glob>`);continue}let c=/query\s*:\s*['"]\?raw['"]/.test(a.slice(o[0].length));t.push(`<glob ${c?`raw`:`code`} ${s.join(`,`)}>`)}return t}function mS(e,t,n){let r=t=>{let n=hS(e,t);if(n===null)return null;let r=n.split(`/`).map(e=>e===`**`?`(?:.*/)?`:`${e.replace(/[.+^${}()|[\]\\]/g,`\\$&`).replace(/\*/g,`[^/]*`).replace(/\?/g,`[^/]`)}/`).join(``);return RegExp(`^${r.replace(/\(\?:\.\*\/\)\?$|\/$/,``)}$`)},i=t.filter(e=>!e.startsWith(`!`)).map(r),a=t.filter(e=>e.startsWith(`!`)).map(e=>r(e.slice(1)));return Object.keys(n).filter(e=>i.some(t=>t?.test(e))&&!a.some(t=>t?.test(e)))}function hS(e,t){let n=e.split(`/`).slice(0,-1);for(let e of t.split(`/`))if(e!==``&&e!==`.`){if(e===`..`){if(!n.length)return null;n.pop()}else n.push(e)}return n.join(`/`)}function gS(e,t,n){if(!t.startsWith(`.`))return null;let r=hS(e,t.replace(/\?.*$/,``));if(r===null)return null;for(let e of[r,`${r}.ts`,`${r}/index.ts`])if(e in n)return e;return null}function _S(e,t,n=new Set){let r=new Set,i=new Set,a=[],o=[...t];for(let n of t)n in e||a.push(`<entry> -> ${n}`);for(;o.length;){let t=o.pop();if(r.has(t)||!(t in e))continue;r.add(t);let s=dS(e[t]),c=n.has(t)?s.replace(sS,`
`).replace(cS,`
`):``;for(let r of fS(s)){if(r.typeOnly)continue;let s=/^<glob (raw|code) (.*)>$/.exec(r.spec);if(s){for(let n of mS(t,s[2].split(`,`),e))s[1]===`raw`?i.add(n):o.push(n);continue}if(n.has(t)&&r.names.length&&!r.names.some(e=>RegExp(`(^|[^\\w$.])${e.replace(/\$/g,`\\$`)}(?![\\w$])`).test(c)))continue;let l=gS(t,r.spec,e);l===null?a.push(`${t} -> ${r.spec}`):o.push(l)}}return{files:[...new Set([...r,...i])].sort(),missing:a}}function vS(e){let t=2166136261,n=1523705862;for(let r=0;r<e.length;r++){let i=e.charCodeAt(r);t=Math.imul(t^i,16777619)>>>0,n=Math.imul(n^i,16777621)>>>0}return t.toString(16).padStart(8,`0`)+n.toString(16).padStart(8,`0`)}function yS(e){let t=[],n=new Set,r=e=>{if(e===null){t.push(`null`);return}switch(typeof e){case`number`:t.push(Object.is(e,-0)?`-0`:String(e));return;case`string`:t.push(JSON.stringify(e));return;case`boolean`:t.push(e?`true`:`false`);return;case`undefined`:t.push(`undefined`);return;case`bigint`:t.push(`${e}n`);return;case`object`:break;default:throw Error(`stableText: cannot render a ${typeof e}`)}let i=e;if(n.has(i))throw Error(`stableText: cyclic value`);if(n.add(i),Array.isArray(i)){t.push(`[`);for(let e of i)r(e),t.push(`,`);t.push(`]`)}else if(ArrayBuffer.isView(i)&&!(i instanceof DataView)){t.push(`${i.constructor.name}[`);for(let e of i)r(e),t.push(`,`);t.push(`]`)}else if(Object.getPrototypeOf(i)===Object.prototype){t.push(`{`);for(let e of Object.keys(i).sort())t.push(JSON.stringify(e),`:`),r(i[e]),t.push(`,`);t.push(`}`)}else throw Error(`stableText: cannot render a ${i.constructor?.name??`object`}`);n.delete(i)};return r(e),t.join(``)}var bS=Object.fromEntries(Object.entries(Object.assign({"./barkNoise.ts":yx,"./barkScans.ts":bx,"./colliders.ts":xx,"./farCanopy.ts":Sx,"./foliageSpace.ts":Cx,"./forestFloor.ts":wx,"./grass.ts":Tx,"./index.ts":Ex,"./instanceData.ts":Dx,"./leafAtlas.ts":Ox,"./meshBuilder.ts":kx,"./noise.ts":Ax,"./params.ts":jx,"./parkPlanting.ts":Mx,"./placement.ts":Nx,"./placementPlan.ts":Px,"./placementRules.ts":Fx,"./plantShadows.ts":Ix,"./plantSurfaces.ts":Lx,"./region.ts":Rx,"./renderBundle.ts":zx,"./rockGen.ts":Bx,"./slices.ts":Vx,"./sourceClosure.ts":Hx,"./spatialHash.ts":Ux,"./spots.ts":Wx,"./terrainFields.ts":Gx,"./testScene.ts":Kx,"./treeAssets.ts":qx,"./treeAttachments.ts":Jx,"./treeBranch.ts":Yx,"./treeBuild.worker.ts":Xx,"./treeBuildPool.ts":Zx,"./treeGen.ts":Qx,"./treeLeafShapes.ts":$x,"./treeNeedleShapes.ts":eS,"./treePack.ts":tS,"./treePlan.ts":nS,"./treePlanBroad.ts":rS,"./treePlanFar.ts":iS,"./treeSystem.ts":aS,"./variants.ts":oS,"../../world/track/rng.ts":D})).map(([e,t])=>[e.startsWith(`../../`)?`src/${e.slice(6)}`:`src/render/vegetation/${e.slice(2)}`,t])),xS=3,SS=`src/render/vegetation/variants.ts`,CS=/export const VARIANT_DEFS\b[\s\S]*?\n\];/,wS=new Set;function TS(e,t,n){return e.missing.length?(wS.has(n)||(wS.add(n),console.warn(`tree cache: off for ${n}, the generator imports what it cannot follow: ${e.missing.join(`; `)}`)),null):vS(e.files.map(e=>`${e}\n${t[e]}`).join(`
`))}function ES(e){let t=e[SS]??``,n=t.replace(CS,``),r=n===t?{...e}:{...e,[SS]:n};return{closure:_S(r,[SS,`src/render/vegetation/treeGen.ts`,`src/render/vegetation/treePack.ts`],new Set(n===t?[]:[SS])),sources:r}}function DS(e){let{closure:t,sources:n}=ES(e);return TS(t,n,`the tree meshes`)}function OS(e){return TS(_S(e,[`src/render/vegetation/leafAtlas.ts`]),e,`the leaf atlas`)}function kS(e){return`${yS({...e,plan:null})}\n${yS(e.plan?e.plan(new ue(e.seed)):null)}`}var AS,jS=()=>AS===void 0?AS=DS(bS):AS,MS=new Map;function NS(e,t){let n=`${e}${t}`;if(MS.has(n))return MS.get(n);let r=jS(),i=Q[e],a=null;if(r!==null)try{a=`tree-${xS}-${t?`dense`:`plain`}-${e}-${vS(`${r}\n${kS(i)}\n${t}`)}`}catch(e){wS.has(i.name)||(wS.add(i.name),console.warn(`tree cache: off for ${i.name}, its plan cannot be hashed:`,e))}return MS.set(n,a),a}function PS(){let e=globalThis.process;return e?.versions?.node&&e.getBuiltinModule?e.getBuiltinModule(`node:fs`):null}function FS(){return{}.FPV_TREE_CACHE_DIR||`.cache/tree-meshes`}async function IS(e,t){if(typeof CompressionStream>`u`||typeof DecompressionStream>`u`)return null;let n=new Blob([e]).stream().pipeThrough(t?new DecompressionStream(`deflate-raw`):new CompressionStream(`deflate-raw`));return new Response(n).arrayBuffer()}var LS=e=>e.replace(/^([a-z]+)-\d+-(.*)-[0-9a-f]{16}$/,`$1-$2`),RS=(e,t)=>t!==e&&(LS(t)===LS(e)||e.startsWith(`tree-`)&&/^trees-[12]-/.test(t));function zS(){return typeof indexedDB>`u`?null:new Promise((e,t)=>{let n=indexedDB.open(`fpv-tree-meshes`,1);n.onupgradeneeded=()=>n.result.createObjectStore(`meshes`),n.onsuccess=()=>e(n.result),n.onerror=()=>t(n.error)})}async function BS(e){try{let t=await VS(e);return t?await IS(t,!0):null}catch{return null}}async function VS(e){try{let t=PS();if(t){let n=t.readFileSync(`${FS()}/${e}.bin`);return n.buffer.slice(n.byteOffset,n.byteOffset+n.byteLength)}let n=await zS();if(!n)return null;let r=await new Promise((t,r)=>{let i=n.transaction(`meshes`).objectStore(`meshes`).get(e);i.onsuccess=()=>t(i.result),i.onerror=()=>r(i.error)});return n.close(),r??null}catch{return null}}async function HS(e,t){try{let n=await IS(t,!1);if(!n)return;let r=PS();if(r){let t=FS();r.mkdirSync(t,{recursive:!0});for(let n of r.readdirSync(t))n.endsWith(`.bin`)&&RS(e,n.slice(0,-4))&&r.unlinkSync(`${t}/${n}`);r.writeFileSync(`${t}/${e}.bin`,new Uint8Array(n));return}let i=await zS();if(!i)return;await new Promise((t,r)=>{let a=i.transaction(`meshes`,`readwrite`),o=a.objectStore(`meshes`),s=o.getAllKeys();s.onsuccess=()=>{for(let t of s.result)RS(e,String(t))&&o.delete(t);o.put(n,e)},a.oncomplete=()=>t(),a.onerror=()=>r(a.error)}),i.close()}catch{}}async function US(e,t){let n=await BS(e);return(n&&_x(n,[Q[t]])?.[0])??null}function WS(e,t){return HS(e,gx([t]))}var GS;function KS(e){return GS===void 0&&(GS=OS(bS)),GS===null?null:`atlas-${xS}-${e}-${vS(`${GS}\n${e}`)}`}function qS(e){let t=[...e.colour,...e.data],n=new Uint32Array(2+t.length);n.set([e.tileSize,e.colour.length,...t.map(e=>e.length)]);let r=new Uint8Array(n.byteLength+t.reduce((e,t)=>e+Math.ceil(t.length/4)*4,0));r.set(new Uint8Array(n.buffer));let i=n.byteLength;for(let e of t)r.set(e,i),i+=Math.ceil(e.length/4)*4;return r.buffer}function JS(e){let[t,n]=new Uint32Array(e,0,2),r=new Uint32Array(e,8,n*2),i=8+n*2*4,a=Array.from(r,t=>{let n=new Uint8Array(e,i,t);return i+=Math.ceil(t/4)*4,n});return i===e.byteLength?{tileSize:t,colour:a.slice(0,n),data:a.slice(n)}:null}async function YS(e){let t=await BS(e);return t?JS(t):null}function XS(e,t){return HS(e,qS(t))}var ZS=1320,QS={arrayStride:24,attributes:[{shaderLocation:0,offset:0,format:`float32x3`},{shaderLocation:1,offset:12,format:`unorm16x2`},{shaderLocation:2,offset:16,format:`unorm16x2`},{shaderLocation:3,offset:20,format:`unorm8x4`}]};async function $S(e){let t=Q.map((e,t)=>e.rock<0?t:-1).filter(e=>e>=0),n=t.map(t=>NS(t,e)),r=await Promise.all(t.map((e,t)=>n[t]?US(n[t],e):null)),i=Q.map(()=>null);t.forEach((e,t)=>{i[e]=r[t]});let a=t.filter((e,t)=>!r[t]);if(a.length){let t=await vx(e,a);if(t)for(let e of a)i[e]=t[e]}let o=await uv(8,void 0,e,i);return await Promise.all(t.map((e,t)=>!r[t]&&n[t]?WS(n[t],o[e]):null)),o}var eC=class e{variants;vertexBuffer;indexBuffer;argsTemplate;triangles=[];vertexBytes;indexBytes;drawLayout;cullLayout;finalizeLayout;atlasView;atlasDataView;barkNoiseView;barkColourView;barkSurfaceView;barkSampler;cullPipe;finalizePipe;treePipes;rockPipe;ready;atlas;atlasData;barkNoise;barkTextures;leafSampler;dense;static async create(t){let n=Ht(t.quality),r=n?Bm:512,i=KS(r),[a,o,s]=await Promise.all([$S(n),n?$S(!1):null,i?YS(i):null]);sv(o??a);let c=s;c||(c=await fh(8,void 0,r),i&&await XS(i,c));let l=await lx(),u=fx(t.quality.tier)!==null&&t.features.has(`texture-compression-bc`)?await mx():null;return new e(t,a,c,l,n,u)}constructor(e,t,n,r,i,a){let o=e.device;this.variants=t,this.dense=i;let s=Qf(this.variants.flatMap(e=>e.lods));this.argsTemplate=new Uint32Array(330),s.ranges.forEach((e,t)=>{this.argsTemplate.set([e.indexCount,0,e.firstIndex,e.baseVertex,0],t*5),this.triangles.push(e.indexCount/3)}),this.vertexBytes=s.vertices.byteLength,this.indexBytes=s.indices.byteLength,this.vertexBuffer=o.createBuffer({label:`tree-vertices`,size:this.vertexBytes,usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST}),o.queue.writeBuffer(this.vertexBuffer,0,s.vertices),this.indexBuffer=o.createBuffer({label:`tree-indices`,size:this.indexBytes,usage:GPUBufferUsage.INDEX|GPUBufferUsage.COPY_DST}),o.queue.writeBuffer(this.indexBuffer,0,s.indices);let c=(e,t)=>{let r=n.tileSize*4,i=n.tileSize*5,a=o.createTexture({label:e,size:[r,i],mipLevelCount:Vm(n.tileSize),format:`rgba8unorm`,usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});return t.forEach((e,t)=>{let n=r>>t,s=i>>t;o.queue.writeTexture({texture:a,mipLevel:t},e,{bytesPerRow:n*4},[n,s])}),a};if(this.atlas=c(`leaf-atlas-colour`,n.colour),this.atlasData=c(`leaf-atlas-data`,n.data),this.atlasView=this.atlas.createView(),this.leafSampler=o.createSampler({label:`leaf-atlas`,magFilter:`linear`,minFilter:`linear`,mipmapFilter:`linear`,addressModeU:`clamp-to-edge`,addressModeV:`clamp-to-edge`,maxAnisotropy:i?16:1}),this.atlasDataView=this.atlasData.createView(),this.barkNoise=o.createTexture({label:`bark-noise`,size:[128,128,128],dimension:`3d`,format:`rgba8unorm`,usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST}),o.queue.writeTexture({texture:this.barkNoise},r,{bytesPerRow:512,rowsPerImage:128},[128,128,128]),this.barkNoiseView=this.barkNoise.createView({dimension:`3d`}),a){let t=hx(o,a,fx(e.quality.tier)??0);this.barkTextures=[t.colour,t.surface]}else{let e=e=>{let t=o.createTexture({label:e,size:[1,1,1],format:`rgba8unorm`,usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});return o.queue.writeTexture({texture:t},new Uint8Array([128,128,128,255]),{bytesPerRow:4},[1,1,1]),t};this.barkTextures=[e(`bark-scans-none-colour`),e(`bark-scans-none-surface`)]}this.barkColourView=this.barkTextures[0].createView({dimension:`2d-array`}),this.barkSurfaceView=this.barkTextures[1].createView({dimension:`2d-array`}),this.barkSampler=o.createSampler({label:`bark-scans`,magFilter:`linear`,minFilter:`linear`,mipmapFilter:`linear`,addressModeU:`repeat`,addressModeV:`repeat`,maxAnisotropy:i?16:8});let l=GPUShaderStage.COMPUTE,u=GPUShaderStage.VERTEX,d=GPUShaderStage.FRAGMENT,f=(e,t,n)=>({binding:e,visibility:t,buffer:{type:n}});this.drawLayout=o.createBindGroupLayout({label:`tree-draw`,entries:[f(0,u|d,`uniform`),f(1,u|d,`read-only-storage`),f(2,u,`read-only-storage`),f(3,u|d,`read-only-storage`),{binding:4,visibility:d,texture:{sampleType:`float`}},{binding:5,visibility:d,texture:{sampleType:`float`}},{binding:6,visibility:u|d,texture:{sampleType:`float`,viewDimension:`3d`}},{binding:7,visibility:d,sampler:{type:`filtering`}},{binding:8,visibility:u|d,texture:{sampleType:`float`,viewDimension:`2d-array`}},{binding:9,visibility:u|d,texture:{sampleType:`float`,viewDimension:`2d-array`}},{binding:10,visibility:u|d,sampler:{type:`filtering`}},f(11,d,`read-only-storage`)]}),this.cullLayout=o.createBindGroupLayout({label:`tree-cull`,entries:[f(0,l,`uniform`),f(1,l,`read-only-storage`),f(2,l,`read-only-storage`),f(3,l,`storage`),f(4,l,`storage`)]}),this.finalizeLayout=o.createBindGroupLayout({label:`tree-finalize`,entries:[f(0,l,`uniform`),f(1,l,`read-only-storage`),f(2,l,`storage`)]});let p=t=>o.createPipelineLayout({bindGroupLayouts:[e.frame.layout,e.world.layout,t]}),m=e.module(`vegetation/tree_cull.wgsl`),h=e.module(`vegetation/tree_finalize.wgsl`),g=o.createComputePipelineAsync({label:`tree-cull`,layout:p(this.cullLayout),compute:{module:m,entryPoint:`cull`}}),_=o.createComputePipelineAsync({label:`tree-finalize`,layout:p(this.finalizeLayout),compute:{module:h,entryPoint:`finalize`}}),v=(t,n,r)=>{let i=e.module(n);return o.createRenderPipelineAsync({label:t,layout:p(this.drawLayout),vertex:{module:i,entryPoint:`vs`,buffers:[QS],constants:r},fragment:{module:i,entryPoint:`fs`,targets:It},primitive:{topology:`triangle-list`,cullMode:`none`},depthStencil:Lt})};this.ready=Promise.all([g,_,v(`rock-draw`,`vegetation/rock.wgsl`),...[0,1,2].map(e=>v(`tree-draw-lod${e}`,`vegetation/tree.wgsl`,{LOD:e}))]).then(([e,t,n,...r])=>{this.cullPipe=e,this.finalizePipe=t,this.rockPipe=n,this.treePipes=r})}isRockDraw(e){return X_(Math.floor(e/3))}destroy(){this.vertexBuffer.destroy(),this.indexBuffer.destroy(),this.atlas.destroy(),this.atlasData.destroy(),this.barkNoise.destroy();for(let e of this.barkTextures)e.destroy()}},tC=264,nC=30,rC=class{assets;slots;instanceBytes;bufferBytes;counts={plantLod:[0,0,0],rockLod:[0,0,0]};sampled=!1;instances;proxied;variantTable;counters;visible;args;staging;cullGroup;finalizeGroup;draws=[];copyQueued=!1;mapping=!1;sinceSample=0;constructor(e,t,n,r,i){this.assets=t;let a=e.device,o=GPUBufferUsage.STORAGE;this.slots=r.slots,this.instanceBytes=r.instances.byteLength;let s=Math.max(r.slots*3*4,256);this.bufferBytes=this.instanceBytes+r.variants.byteLength+s+tC+ZS,this.instances=a.createBuffer({label:`tree-instances`,size:this.instanceBytes,usage:o|GPUBufferUsage.COPY_DST}),a.queue.writeBuffer(this.instances,0,r.instances),this.proxied=a.createBuffer({label:`tree-proxied`,size:Math.max(16,Math.ceil(r.slots/32)*4),usage:o|GPUBufferUsage.COPY_DST}),this.variantTable=a.createBuffer({label:`tree-variants`,size:r.variants.byteLength,usage:o|GPUBufferUsage.COPY_DST}),a.queue.writeBuffer(this.variantTable,0,r.variants),this.counters=a.createBuffer({label:`tree-counts`,size:tC,usage:o|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST}),this.visible=a.createBuffer({label:`tree-visible`,size:s,usage:o}),this.args=a.createBuffer({label:`tree-args`,size:ZS,usage:o|GPUBufferUsage.INDIRECT|GPUBufferUsage.COPY_DST}),a.queue.writeBuffer(this.args,0,t.argsTemplate),this.staging=i?a.createBuffer({label:`tree-count-readback`,size:tC,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST}):null;let c=(e,t)=>({binding:e,resource:{buffer:t}});this.cullGroup=a.createBindGroup({label:`tree-cull`,layout:t.cullLayout,entries:[c(0,n),c(1,this.instances),c(2,this.variantTable),c(3,this.counters),c(4,this.visible)]}),this.finalizeGroup=a.createBindGroup({label:`tree-finalize`,layout:t.finalizeLayout,entries:[c(0,n),c(1,this.counters),c(2,this.args)]});let l=(e,i)=>{let o=e*3+i;this.draws.push({k:o,group:a.createBindGroup({label:`tree-draw-${o}`,layout:t.drawLayout,entries:[c(0,n),c(1,this.instances),{binding:2,resource:{buffer:this.visible,offset:4*(i*r.slots+r.first[e])}},c(3,this.variantTable),{binding:4,resource:t.atlasView},{binding:5,resource:t.atlasDataView},{binding:6,resource:t.barkNoiseView},{binding:7,resource:t.leafSampler},{binding:8,resource:t.barkColourView},{binding:9,resource:t.barkSurfaceView},{binding:10,resource:t.barkSampler},c(11,this.proxied)]})})};for(let e=0;e<3;e++)for(let t=0;t<22;t++)!X_(t)&&r.count[t]>0&&l(t,e);for(let e=0;e<22;e++)if(X_(e)&&r.count[e]>0)for(let t=0;t<3;t++)l(e,t)}setProxied(e,t){e.device.queue.writeBuffer(this.proxied,0,t.buffer,t.byteOffset,Math.min(t.byteLength,this.proxied.size))}pollReadback(){let e=this.staging;e&&this.copyQueued&&!this.mapping&&(this.copyQueued=!1,this.mapping=!0,e.mapAsync(GPUMapMode.READ).then(()=>{let t=new Uint32Array(e.getMappedRange().slice(0));e.unmap(),this.counts.plantLod.fill(0),this.counts.rockLod.fill(0);for(let e=0;e<66;e++){let n=X_(Math.floor(e/3))?this.counts.rockLod:this.counts.plantLod;n[e%3]+=t[e]}this.sampled=!0,this.mapping=!1},()=>{this.mapping=!1}))}encodePre(e,t){if(this.slots===0)return;this.clearCounters(e);let n=e.beginComputePass({label:`tree-cull`});this.encodeCull(n,t),n.end(),this.copyCounters(e)}clearCounters(e){this.slots!==0&&e.clearBuffer(this.counters)}encodeCull(e,t){this.slots!==0&&(e.setBindGroup(0,t.frame.group),e.setBindGroup(1,t.world.group),e.setPipeline(this.assets.cullPipe),e.setBindGroup(2,this.cullGroup),e.dispatchWorkgroups(Math.ceil(this.slots/64)),e.setPipeline(this.assets.finalizePipe),e.setBindGroup(2,this.finalizeGroup),e.dispatchWorkgroups(1))}copyCounters(e){this.slots!==0&&this.staging&&!this.copyQueued&&!this.mapping&&++this.sinceSample>=nC&&(this.sinceSample=0,e.copyBufferToBuffer(this.counters,0,this.staging,0,tC),this.copyQueued=!0)}encodeGBuffer(e){if(this.slots===0)return;e.setVertexBuffer(0,this.assets.vertexBuffer),e.setIndexBuffer(this.assets.indexBuffer,`uint32`);let t=null;for(let n of this.draws){let r=this.assets.isRockDraw(n.k)?this.assets.rockPipe:this.assets.treePipes[n.k%3];r!==t&&(e.setPipeline(r),t=r),e.setBindGroup(2,n.group),e.drawIndexedIndirect(this.args,n.k*5*4)}}destroy(){for(let e of[this.proxied,this.instances,this.variantTable,this.counters,this.visible,this.args,this.staging])e?.destroy()}},iC=class{bundles=null;device=null;frame=null;world=null;frameLayout=null;worldLayout=null;invalidate(){this.bundles=null,this.device=null,this.frame=this.world=null,this.frameLayout=this.worldLayout=null}encode(e,t,n){if(!this.bundles||this.device!==t.device||this.frame!==t.frame.group||this.world!==t.world.group||this.frameLayout!==t.frame.layout||this.worldLayout!==t.world.layout){let e=t.device.createRenderBundleEncoder({label:`vegetation-gbuffer`,colorFormats:It.map(e=>e.format),depthStencilFormat:Lt.format,sampleCount:1});e.setBindGroup(0,t.frame.group),e.setBindGroup(1,t.world.group),n(e),this.bundles=[e.finish()],this.device=t.device,this.frame=t.frame.group,this.world=t.world.group,this.frameLayout=t.frame.layout,this.worldLayout=t.world.layout}e.executeBundles(this.bundles),e.setBindGroup(0,t.frame.group),e.setBindGroup(1,t.world.group)}},aC=2147516416;function oC(e){let t=e.map(e=>Math.round(Math.max(0,Math.min(2,e))*127.5));return(t[0]|t[1]<<8|t[2]<<16|128<<24)>>>0}function sC(e,t=[]){let n=Math.min(t.length,g);if(n===0)return{placement:e,count:0};let r=e.plants,i=r.count+n,a={count:i,pos:new Float32Array(i*3),scale:new Float32Array(i),yaw:new Float32Array(i),variant:new Uint8Array(i),tint:new Uint32Array(i),nrm:new Uint32Array(i),pathDist:new Float32Array(i)};a.pos.set(r.pos.subarray(0,r.count*3),n*3);for(let e of[`scale`,`yaw`,`variant`,`tint`,`nrm`,`pathDist`])a[e].set(r[e].subarray(0,r.count),n);let o=e.trees,s=e.bushes;for(let e=0;e<n;e++){let n=t[e];a.pos.set(n.pos,e*3),a.scale[e]=n.scale,a.yaw[e]=n.yaw,a.variant[e]=n.variant,a.tint[e]=oC(n.tint),a.nrm[e]=aC,a.pathDist[e]=1/0,Q[n.variant].group===`tree`?o++:s++}let c=new Float32Array(i);return c.set(e.plantRing.subarray(0,r.count),n),{placement:{...e,plants:a,trees:o,bushes:s,plantRing:c,obstacleTrees:e.obstacleTrees+n},count:n}}function cC(e,t,n){return Math.min(e.plants.count,t+n)}function lC(e=[]){return e.slice(0,g).flatMap(e=>ey(e.variant,e))}function uC(e=[]){return e.slice(0,g).flatMap(e=>Kv(e.variant,e))}var dC=1,fC=.45,pC=1.2;function*mC(e){let t=e.plants,n={x:0,z:0,radius:0,strength:0,conifer:!1};for(let e=0;e<t.count;e++){let r=Q[t.variant[e]];if(r.group===`rock`)continue;let i=tv(t.variant[e]);n.x=t.pos[e*3],n.z=t.pos[e*3+2],n.radius=Math.max((i?Math.max(i.crownR[0],i.crownR[2]):.25*r.height)*t.scale[e],pC),n.strength=r.group===`tree`?dC:fC,n.conifer=/^(spruce|pine|juniper)/.test(r.name),yield n}}function*hC(e){let t=e.plants,n={x:0,z:0,radius:0,conifer:!1};for(let e=0;e<t.count;e++){let r=Q[t.variant[e]],i=tv(t.variant[e]);r.group===`tree`&&i&&(n.x=t.pos[e*3],n.z=t.pos[e*3+2],n.radius=i.trunkRadius*t.scale[e],n.conifer=/^(spruce|pine|juniper)/.test(r.name),yield n)}}function gC(e,t,n=null){let r=Ef(e,mC(t));return n&&!n.parkMap&&n.path.length>1&&Df(e,n.path,n.closed,r),wf(e,r),Af(e,Mf(e,hC(t))),r}var _C=.45,vC=.6,yC=.4;function*bC(e){let t=e.plants,n={x:0,y:0,z:0,cx:0,cy:0,cz:0,rx:0,ry:0,rz:0,density:0,cone:!1};for(let e=0;e<t.count;e++){let r=Q[t.variant[e]],i=tv(t.variant[e]);if(r.group===`rock`||!i)continue;let a=t.scale[e],o=Math.cos(t.yaw[e]),s=Math.sin(t.yaw[e]);n.x=t.pos[e*3],n.y=t.pos[e*3+1],n.z=t.pos[e*3+2],n.cx=(o*i.crownC[0]+s*i.crownC[2])*a,n.cy=i.crownC[1]*a,n.cz=(-s*i.crownC[0]+o*i.crownC[2])*a,n.rx=i.crownR[0]*a,n.ry=i.crownR[1]*a,n.rz=i.crownR[2]*a,n.density=r.group===`bush`?yC:/^(spruce|pine|juniper)/.test(r.name)?vC:_C,n.cone=i.species===`spruce`,yield n}}function xC(e,t){Bu(e,Hu(e,bC(t)))}var SC=11e-7,CC=[.8,.6],wC=4;function TC(){let e=Bb(),t={dir:[CC[0],CC[1]],speed:wC},n={pos:[0,0,0],vel:[0,0,0],thrust:0},r={pos:[0,0,0],vel:[0,0,0],thrust:0},i=!1,a=new iC,o=e=>{u?.encodeGBuffer(e),m?.encodeGBuffer(e),h?.encodeGBuffer(e)},s=[0,0],c=null,l=null,u=null,d=null,f=null,p=!1,m=null,h=null,g=null,_=0,v=null,y=null,b=0,x=[],S=0,C=null,w=-1,T=-1,E=!1,D=new Set,O=new Set,k=0,A=null;function j(e){if(!m||!A)return;let t=new Uint32Array(Math.ceil(m.slots/32));A.forEach((e,n)=>{let r=n-b;(r<0||D.has(r)||O.has(r))&&(t[e>>5]|=1<<(e&31))}),m.setProxied(e,t)}let M=null,ee=0,te=0,ne=0,re={...Rb.medium,slots:0,draws:66};function ie(e,t){if(!c||!C)return;let n=Ht(e.quality);if(e.rt.version!==T||n!==E){let t=[...lC(c.park?.park.plantings),...uC(c.park?.park.plantings)],r=dy(n,e.rt.allStatic().length-S+t.length),i=n?ly(r):0,a=r-i;if(a!==w||n!==E){w=a,E=n,k=i,M=null,D=new Set;let r=Ey(C,le(c),a,{alongLine:n,taken:D});r.push(...t),S=r.length,e.rt.setStatic(`vegetation`,r),n||(e.rt.remove(`vegetation-camera`),O=new Set),j(e)}}n&&k>0&&t&&(!M||Math.hypot(t[0]-M[0],t[2]-M[2])>50)&&(M=[t[0],t[1],t[2]],O=new Set,e.rt.setDynamic(`vegetation-camera`,Ey(C,M,k,{within:150,skip:D,taken:O})),j(e)),T=e.rt.version}function ae(e){a.invalidate(),u?.destroy(),u=l&&d?new Gb(e,d,l,!1):null}function oe(e){if(a.invalidate(),m?.destroy(),m=null,ee=te=ne=0,!l||!f||!y)return;let t=Uy[e.quality.tier],n=cC(y,t.plants,b),r=Math.min(t.rocks,y.rocks.count);for(let e=0;e<n;e++)f.variants[y.plants.variant[e]].def.group===`tree`?ee++:te++;ne=r;let i=Yb([{set:y.plants,count:n},{set:y.rocks,count:r}],f.variants);m=new rC(e,f,l,i,!1),A=i.runSlots[0],j(e)}function se(e){if(a.invalidate(),h?.destroy(),h=null,_=0,!l||!g||!y||!c)return;let t=e.quality,n=Uy[t.tier],r=cC(y,n.plants,b),i=r-b<n.plants?Wy:y.plantRing[r-1]-24,o=Tb(c.terrain,c.track,{cap:zb[t.tier].cards,radius:t.terrainViewDistance,coveredRing:i,uncoveredNear:150});_=o.uncovered,h=new Db(e,g,l,o)}function ce(e){if(i)return i=!1,r.pos=n.pos,r.vel=n.vel,r.thrust=n.thrust,r;let t=e.quad;if(!t)return null;let a=t.motorOmega;return r.pos=t.pos,r.vel=t.vel,r.thrust=t.armed?SC*(a[0]*a[0]+a[1]*a[1]+a[2]*a[2]+a[3]*a[3]):0,r}function le(e){if(e.track)return e.track.start.pos;let t=e.terrain,n=(t.resolution-1)*t.cellSize;return[t.origin[0]+n/2,0,t.origin[1]+n/2]}return{name:`vegetation`,async init(e){a.invalidate(),l=e.device.createBuffer({label:`vegetation-params`,size:160,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),g=new Eb(e),d=new Wb(e),f=await eC.create(e),v=Xb(e.quality),ae(e)},async ready(){await Promise.all([f?.ready,g?.ready,d?.ready])},setScene(e,t){c=t,y=hb(t.terrain,t.track,Uy.ultra),x=xy(y),d?.setCover(gC(t.terrain,y,t.track)),C=y,w=-1,ie(e);let n=sC(y,t.park?.park.plantings);y=n.placement,b=n.count,xC(t.terrain,y);let r=Xb(e.quality);v=v?{...r,grassBladesPerM2:v.grassBladesPerM2,grassDistance:v.grassDistance}:r,oe(e),se(e)},update(n,r){if(!l||!c)return;let i=Xb(n.quality),a=Zb(v,i);if(v=i,f&&!p&&f.dense!==Ht(n.quality)&&(p=!0,eC.create(n).then(e=>e.ready.then(()=>e)).then(e=>{if(p=!1,!l){e.destroy();return}let t=f;f=e,oe(n),t?.destroy()},()=>{p=!1})),ie(n,r.camera.pos),a.grass&&ae(n),a.trees&&oe(n),a.far&&se(n),!u)return;u.pollReadback(),m?.pollReadback();let o=c.terrain;s[0]=r.camera.pos[0],s[1]=r.camera.pos[2],Object.assign(re,Rb[n.quality.tier]),re.slots=m?m.slots:0,Vb(e,{windDir:t.dir,windSpeed:t.speed,parkRadius:c.track?.parkMap?.radius??0,quad:ce(r),budget:u.budget,waterLevel:o.waterLevel,seed:o.seed,cameraXZ:s,tree:re,farDistance:v?v.farDistance:0}),n.device.queue.writeBuffer(l,0,e.u32)},encodePre(e,t){if(c){if(u&&m&&m.slots>0){u.clearCounters(e),m.clearCounters(e);let n=e.beginComputePass({label:`vegetation-cull`});u.encodeCull(n,t),m.encodeCull(n,t),n.end(),u.copyCounters(e),m.copyCounters(e);return}u?.encodePre(e,t),m?.encodePre(e,t)}},encodeGBuffer(e,t){c&&a.encode(e,t,o)},setQuad(e,t,r){n.pos=e,n.vel=t,n.thrust=r,i=!0},setWind(e,n){t.dir[0]=e[0],t.dir[1]=e[1],t.speed=n},vegetationColliders(){return x.slice()},stats(){let e=u?.counts,t=!!u&&u.sampled,n=m?.counts,r=!!m&&m.sampled;return{grassInstances:t&&e?e.lod[0]+e.lod[1]+e.lod[2]:null,grassPatches:t&&e?e.patches:null,grassLod:t&&e?[e.lod[0],e.lod[1],e.lod[2]]:null,grassCapacity:u?u.budget.caps[0]+u.budget.caps[1]+u.budget.caps[2]:0,grassBytes:u?u.budget.bladeBytes:0,trees:ee,bushes:te,rocks:ne,treeLod:r&&n?[n.plantLod[0],n.plantLod[1],n.plantLod[2]]:null,rockLod:r&&n?[n.rockLod[0],n.rockLod[1],n.rockLod[2]]:null,treeSlots:m?m.slots:0,treeBytes:m?m.bufferBytes:0,meshBytes:f?f.vertexBytes+f.indexBytes:0,meshTriangles:f?f.triangles.slice():[],colliders:x.length,rtPrimitives:S,farCards:h?h.cards:0,farUncovered:_,farBytes:h?h.bytes:0,farTriangles:h?2*h.cards:0}},destroy(){a.invalidate(),u?.destroy(),m?.destroy(),h?.destroy(),f?.destroy(),l?.destroy(),u=null,m=null,h=null,f=null,g=null,d=null,l=null}}}function EC(e,t=12){let n=[],r=(e,t,r,i,a=i,o=i,s=0)=>{let c=t.map((t,n)=>t-e[n]),l=r.map((t,n)=>t-e[n]);(c[1]*l[2]-c[2]*l[1])*i[0]+(c[2]*l[0]-c[0]*l[2])*i[1]+(c[0]*l[1]-c[1]*l[0])*i[2]<0&&([t,r]=[r,t],[a,o]=[o,a]);for(let[c,l]of[[e,i],[t,a],[r,o]])n.push(...c,...l,s)},i=(e,t,n=0)=>{for(let i=0;i<3;i++)for(let a of[-1,1]){let o=[],s=(i+1)%3,c=(i+2)%3,l=[0,0,0];l[i]=a;for(let[n,r]of[[-1,-1],[1,-1],[1,1],[-1,1]]){let l=[...e];l[i]+=a*t[i],l[s]+=n*t[s],l[c]+=r*t[c],o.push(l)}r(o[0],o[1],o[2],l,l,l,n),r(o[0],o[2],o[3],l,l,l,n)}},a=(e,n,i=0,a=t)=>{let o=Math.max(4,a/2),s=(t,r)=>{let i=[Math.cos(t)*Math.sin(r),Math.cos(r),Math.sin(t)*Math.sin(r)],a=i.map((e,t)=>e/n[t]),o=Math.hypot(...a);return{p:i.map((t,r)=>e[r]+t*n[r]),n:a.map(e=>e/o)}};for(let e=0;e<o;e++)for(let t=0;t<a;t++){let n=s(t*2*Math.PI/a,e*Math.PI/o),c=s((t+1)*2*Math.PI/a,e*Math.PI/o),l=s((t+1)*2*Math.PI/a,(e+1)*Math.PI/o),u=s(t*2*Math.PI/a,(e+1)*Math.PI/o);r(n.p,c.p,l.p,n.n,c.n,l.n,i),r(n.p,l.p,u.p,n.n,l.n,u.n,i)}};if(e===`box`&&i([0,0,0],[1,1,1]),e===`gable`){let e=[[-1,-1],[1,-1],[0,1]];for(let t of[-1,1])r([...e[0],t],[...e[1],t],[...e[2],t],[0,0,t]);for(let t=0;t<3;t++){let n=e[t],i=e[(t+1)%3],a=[i[1]-n[1],n[0]-i[0],0],o=Math.hypot(...a);for(let e=0;e<3;e++)a[e]/=o;r([...n,-1],[...i,-1],[...i,1],a),r([...n,-1],[...i,1],[...n,1],a)}}if(e===`sphere`&&a([0,0,0],[1,1,1]),e===`cylinder`)for(let e=0;e<t;e++){let n=e*Math.PI*2/t,i=(e+1)*Math.PI*2/t,a=[Math.cos(n),0,Math.sin(n)],o=[Math.cos(i),0,Math.sin(i)],s=[a[0],-1,a[2]],c=[o[0],-1,o[2]],l=[o[0],1,o[2]],u=[a[0],1,a[2]];r(s,c,l,a,o,o),r(s,l,u,a,o,a),r([0,-1,0],c,s,[0,-1,0]),r([0,1,0],u,l,[0,1,0])}if(e===`cone`)for(let e=0;e<t;e++){let n=e*Math.PI*2/t,i=(e+1)*Math.PI*2/t,a=1/Math.sqrt(1.25),o=[Math.cos(n)*a,.5*a,Math.sin(n)*a],s=[Math.cos(i)*a,.5*a,Math.sin(i)*a],c=[Math.cos(n),-1,Math.sin(n)],l=[Math.cos(i),-1,Math.sin(i)];r(c,l,[0,1,0],o,s,[Math.cos((n+i)/2)*a,.5*a,Math.sin((n+i)/2)*a]),r([0,-1,0],l,c,[0,-1,0])}if(e===`guest`||e===`guestHero`){let o=e===`guestHero`,s=o||t>6,c=o?16:s?10:6,l=o?12:s?8:4,u=(e,t,n=1)=>e+t*16+n*.5,d=(e,t,i=!0)=>{let a=[];for(let t=0;t<e.length;t++){let n=e[t];if(a.push(n),!o||e.length<3||e.length>6||t===e.length-1)continue;let r=e[t+1],i=e[Math.max(0,t-1)],s=e[Math.min(e.length-1,t+2)],c=[...n];c[0]=(n[0]+r[0])/2;for(let e=1;e<=4;e++)c[e]=(n[e]+r[e])/2+(r[0]-n[0])*.125*((r[e]-i[e])/(r[0]-i[0])-(s[e]-n[e])/(s[0]-n[0]));c[1]=Math.max(.001,c[1]),c[2]=Math.max(.001,c[2]);let l=Math.floor(n[5])%16,d=Math.floor(r[5])%16,f=e=>e>=10?e-8:e>=6?e-2:-1,p=f(l)===d?l:f(d)===l?d:-1;c[5]=p<0?(n[5]+r[5])/2:u(p,Math.floor(n[5]/16),((l===p?n[5]%1*2:0)+(d===p?r[5]%1*2:0))/2),a.push(c)}let s=(e,n)=>{let r=n*2*Math.PI/t,i=a[e],o=a[Math.max(0,e-1)],s=a[Math.min(a.length-1,e+1)],c=s[0]-o[0]||1,l=Math.cos(r),u=Math.sin(r),d=l/i[1],f=u/i[2],p=-(d*(s[3]-o[3]+l*(s[1]-o[1]))+f*(s[4]-o[4]+u*(s[2]-o[2])))/c,m=1/Math.hypot(d,p,f);return{p:[i[3]+l*i[1],i[0],i[4]+u*i[2]],n:[d*m,p*m,f*m],joint:i[5]}};for(let e=0;e<a.length-1;e++)for(let r=0;r<t;r++){let t=s(e,r),i=s(e,r+1),a=s(e+1,r+1),o=s(e+1,r),c=e=>{let[t,r,i]=e,a=r.p.map((e,n)=>e-t.p[n]),o=i.p.map((e,n)=>e-t.p[n]);(a[1]*o[2]-a[2]*o[1])*t.n[0]+(a[2]*o[0]-a[0]*o[2])*t.n[1]+(a[0]*o[1]-a[1]*o[0])*t.n[2]<0&&([e[1],e[2]]=[e[2],e[1]]);for(let t of e)n.push(...t.p,...t.n,t.joint)};c([t,i,a]),c([t,a,o])}if(i)for(let e of[0,a.length-1])for(let n=0;n<t;n++){let t=s(e,n),i=s(e,n+1),o=a[e];r([o[3],o[0],o[4]],t.p,i.p,[0,e===0?-1:1,0],void 0,void 0,o[5])}},f=u(0,0),p=u(1,1),m=u(0,2);s&&d([[T,.09,.058,0,.01,m],[.55,.109,.074,0,0,m]],c),d([[.52,.116,.077,0,0,f],[.63,.106,.068,0,0,f],[.765,.137,.073,0,0,f],[.81,.119,.061,0,0,f],[.837,.042,.04,0,0,f]],c),s&&d([[.818,.031,.032,0,0,p],[.881,.034,.034,0,0,p]],8),d(o?[[.865,.018,.024,0,-.013,p],[.875,.034,.038,0,-.01,p],[.891,.047,.047,0,-.005,p],[.908,.052,.053,0,-.001,p],[.927,.059,.06,0,.001,p],[.945,.059,.061,0,.002,p],[.959,.057,.06,0,.003,p],[.975,.05,.056,0,.004,p],[.99,.037,.044,0,.005,p],[.999,.016,.027,0,.007,p]]:s?[[.865,.034,.038,0,-.008,p],[.885,.05,.057,0,-.006,p],[.937,.058,.063,0,0,p],[.975,.05,.056,0,.004,p],[.994,.02,.029,0,.004,p]]:[[.83,.03,.033,0,-.004,p],[.93,.058,.062,0,0,p],[.965,.052,.059,0,.005,u(1,4)],[1,.022,.03,0,.007,u(1,4)]],o?24:s?10:6);for(let e of[-1,1]){let t=e<0?2:3,n=e<0?10:11,r=e<0?4:5,c=e<0?6:7,f=e<0?8:9;if(s){d(o?[[.685,.037,.043,e*.149,0,u(t,0)],[.735,.045,.05,e*.144,0,u(t,0)],[.779,.043,.05,e*.128,0,u(t,0)],[.806,.027,.036,e*.108,0,u(t,0)],[.81,.008,.018,e*.09,0,u(t,0)]]:[[.685,.038,.043,e*.149,0,u(t,0)],[.767,.049,.052,e*.143,0,u(t,0)],[.8,.027,.034,e*.127,0,u(t,0)]],l);let r=[[.446,.025,.018,e*.17,-.002,u(n,1)],[.48,.023,.024,e*.171,0,u(n,1)],[.57,.03,.032,e*.168,0,u(n,1)],[.615,.03,.032,e*.161,0,u(n,1,.5)],[.7,.032,.038,e*.15,0,u(t,1)]];o&&(r.unshift([.402,.014,.009,e*.17,-.007,u(n,1)],[.424,.025,.014,e*.17,-.004,u(n,1)]),a([e*.148,.443,-.004],[.012,.023,.013],u(n,1),8)),d(r,l)}else d([[.446,.025,.02,e*.17,0,u(n,1)],[.615,.031,.033,e*.161,0,u(n,1,.5)],[.69,.038,.043,e*.15,0,u(t,0)],[.785,.041,.044,e*.14,0,u(t,0)]],l);let p=[[.045,.032,.036,e*.057,0,u(c,2)],[.14,.04,.045,e*.057,0,u(c,2)],[.285,.042,.043,e*.057,0,u(c,2,.5)],[.395,.055,.057,e*.057,0,u(r,2)],[.535,.056,.063,e*.057,0,u(r,2)]];s||p.splice(1,1),d(p,l),s?d([[0,.035,.073,e*.057,-.027,u(f,3)],[.033,.037,.074,e*.057,-.027,u(f,3)],[.057,.027,.045,e*.057,-.012,u(f,3)]],o?12:6):i([e*.057,.028,-.026],[.035,.028,.071],u(f,3))}if(s){let e=o?7:4,t=o?24:10,n=(n,r)=>{let i=r*Math.PI*2/t,a=1.8-.68*Math.max(0,-Math.sin(i))**4,o=n/e*a,s=Math.sin(o),c=Math.cos(o),l=[Math.cos(i)*s/.07,c/.075,Math.sin(i)*s/.08],u=1/Math.hypot(...l);return{p:[Math.cos(i)*s*.07,.929+c*.075,.004+Math.sin(i)*s*.08],n:l.map(e=>e*u)}};for(let i=0;i<e;i++)for(let e=0;e<t;e++){let t=n(i,e),a=n(i,e+1),o=n(i+1,e+1),s=n(i+1,e);r(t.p,a.p,o.p,t.n,a.n,o.n,u(1,11)),r(t.p,o.p,s.p,t.n,o.n,s.n,u(1,11))}d([[.829,.008,.01,0,.087,u(1,10)],[.862,.019,.018,0,.09,u(1,10)],[.918,.023,.022,0,.078,u(1,10)],[.955,.011,.012,0,.061,u(1,10)]],o?12:6)}if(s&&!o){i([0,.925,-.061],[.009,.012,.012],p);for(let e of[-1,1])i([e*.023,.943,-.058],[.008,.003,.004],u(1,5))}if(o){d([[.909,.007,.002,0,-.054,p],[.915,.012,.007,0,-.061,p],[.921,.009,.009,0,-.064,p],[.932,.005,.005,0,-.059,p],[.945,.003,.002,0,-.058,p]],16);let e=(e,t,n=0)=>[e,t,.002-.061*Math.sqrt(Math.max(.05,1-(e/.059)**2))-n],t=e=>{let t=[e/.059,0,-Math.sqrt(Math.max(.05,1-(e/.059)**2))],n=Math.hypot(...t);return t.map(e=>e/n)},n=(n,i,a,o,s,c,l=16)=>{let d=e(n,i,c+45e-5),f=t(n);for(let p=0;p<l;p++){let m=p*2*Math.PI/l,h=(p+1)*2*Math.PI/l,g=n+Math.cos(m)*a,_=n+Math.cos(h)*a;r(d,e(g,i+Math.sin(m)*o,c),e(_,i+Math.sin(h)*o,c),f,t(g),t(_),u(1,s))}};for(let i of[-1,1]){a([i*.058,.924,.004],[.01,.019,.009],p,12),a([i*.063,.924,.002],[.0045,.011,.006],u(1,8),12);let o=i*.02,s=.943;n(o,s,.01,.0035,6,8e-4),n(o,s,.0025,.003,7,.0017,12),n(o,s,.0011,.0016,5,.0021,10);for(let n of[-1,1])for(let i=0;i<8;i++){let a=i*Math.PI/8,c=(i+1)*Math.PI/8,l=o+Math.cos(a)*.01,u=o+Math.cos(c)*.01,d=s+n*Math.sin(a)*.0035,f=s+n*Math.sin(c)*.0035,m=e(l,d,.0017),h=e(u,f,.0017),g=e(u,f+n*.0015,2e-4),_=e(l,d+n*.0015,2e-4);r(m,h,g,t(l),t(u),t(u),p),r(m,g,_,t(l),t(u),t(l),p)}n(o,.9514999999999999,.011,.0014,4,5e-4)}n(0,.902,.015,.0025,8,-.0035),n(0,.898,.014,.0025,8,-.0035),n(0,.9002,.012,4e-4,9,-.0032)}}return new Float32Array(n)}var DC=32,OC=8,kC=13,AC=14,jC=15,MC=.5;function NC(){let e,t,n,r,i,a,o,s=new Float32Array(32),c=new Uint32Array(1),l=1,u=0,d=0,f=0,p=0,m=0,h=[],g=Array.from({length:jC},()=>[]),_=[],v=new Float64Array,y=new Float64Array,b=new Float32Array,x=new Float32Array(16),S=new Float32Array,w=new Float32Array(8),E=[],D=[],O=[],A=[],j=new Float32Array,M=new Float32Array,te=new Float32Array,ne=new Uint8Array,re=new Uint32Array,ie=new Int32Array,oe=new Float64Array,ue=new Float64Array,de=new Uint8Array,fe=[0,0,0],pe=[0,0,0,1],me=[0,0,0],he=[0,0,0,1],ge=se(),_e=[0,0,0],ve=[0,0,0],ye=[0,0,0];function be(e){if(e.body<0){for(let t=0;t<3;t++)fe[t]=e.pos[t];for(let t=0;t<4;t++)pe[t]=e.rot[t];return}let t=_[e.body],n=t.rot,r=e.rot;ee(n,e.pos,fe);for(let e=0;e<3;e++)fe[e]+=t.pos[e];pe[0]=n[3]*r[0]+n[0]*r[3]+n[1]*r[2]-n[2]*r[1],pe[1]=n[3]*r[1]-n[0]*r[2]+n[1]*r[3]+n[2]*r[0],pe[2]=n[3]*r[2]+n[0]*r[1]-n[1]*r[0]+n[2]*r[3],pe[3]=n[3]*r[3]-n[0]*r[0]-n[1]*r[1]-n[2]*r[2]}let xe=e=>({type:e.shape===`box`?`obb`:e.shape===`sphere`?`ellipsoid`:e.shape,center:[...e.pos],half:[...e.half],rot:[...e.rot],material:{albedo:e.color,roughness:e.roughness,metalness:e.metalness,...e.emissive?{emissive:e.color.map(t=>t*e.emissive)}:{}}});function Se(e){r=e.device.createBindGroup({layout:n,entries:[{binding:0,resource:{buffer:i}},{binding:1,resource:{buffer:a}},{binding:2,resource:{buffer:o}}]})}function Ce(e,t){let n=Math.max(16,16*t);o&&n<=x.length||(x=new Float32Array(2**Math.ceil(Math.log2(n))),o?.destroy(),o=e.device.createBuffer({label:`park stair foot contacts`,size:x.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}),i&&Se(e))}function we(e,t){t<=l&&i||(l=2**Math.ceil(Math.log2(Math.max(64,t))),s=new Float32Array(l*DC),c=new Uint32Array(l),i?.destroy(),a?.destroy(),i=e.device.createBuffer({label:`resident park instances`,size:s.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}),a=e.device.createBuffer({label:`visible park instance indices`,size:c.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}),Se(e))}function Te(e,t){be(t),s.fill(0,e,e+DC),s.set(fe,e),s[e+3]=t.roughness,s.set(pe,e+4),s.set(t.half,e+8),s[e+11]=t.metalness,s.set(t.color,e+12),s[e+15]=t.emissive,s.set(fe,e+16),s[e+19]=1,s.set(pe,e+20),s[e+27]=s[e+31]=-Math.max(0,[`paint`,`concrete`,`timber`,`fabric`,`masonry`,`foliage`,`glass`,`paving`].indexOf(t.surface??`paint`))}return{name:`park`,sharedOverlayPass:!0,init(e){n=e.device.createBindGroupLayout({entries:[0,1,2].map(e=>({binding:e,visibility:GPUShaderStage.VERTEX,buffer:{type:`read-only-storage`}}))});let r=e.module(`park/parts.wgsl`,ae());t=e.device.createRenderPipeline({label:`resident park parts and skinned guests`,layout:e.device.createPipelineLayout({bindGroupLayouts:[e.frame.layout,e.world.layout,n]}),vertex:{module:r,entryPoint:`vs`,buffers:[{arrayStride:28,attributes:[{shaderLocation:0,offset:0,format:`float32x3`},{shaderLocation:1,offset:12,format:`float32x3`},{shaderLocation:2,offset:24,format:`float32`}]}]},fragment:{module:r,entryPoint:`fs`,targets:It},primitive:{topology:`triangle-list`,cullMode:`back`},depthStencil:Lt});for(let t of[`box`,`cylinder`,`sphere`,`cone`,`guest`])for(let n of[12,6]){let r=EC(t,n),i=e.device.createBuffer({label:`park ${t} ${n}`,size:r.byteLength,usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST});e.device.queue.writeBuffer(i,0,r),h.push({buffer:i,count:r.length/7})}for(let t of[`cylinder`,`sphere`,`cone`]){let n=EC(t,48),r=e.device.createBuffer({label:`park ${t} 48`,size:n.byteLength,usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST});e.device.queue.writeBuffer(r,0,n),h.push({buffer:r,count:n.length/7})}let i=EC(`guestHero`,24),a=e.device.createBuffer({label:`park guest hero`,size:i.byteLength,usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST});e.device.queue.writeBuffer(a,0,i),h.push({buffer:a,count:i.length/7});let o=EC(`gable`),s=e.device.createBuffer({label:`park exact triangular prism`,size:o.byteLength,usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST});e.device.queue.writeBuffer(s,0,o),h.push({buffer:s,count:o.length/7}),Ce(e,1),we(e,64)},setScene(t,n){if(e=n.park,t.rt.remove(`park`),t.rt.remove(`park-moving`),u=d=f=p=0,!e)return;let r=e.park;_=r.bodies.map(()=>se());for(let t=0;t<_.length;t++)e.bodyPose(t,e.renderTime,_[t]);j=Float32Array.from(r.parts,e=>Math.hypot(...e.half)),M=Float32Array.from(r.parts,e=>Math.max(...e.half)),oe=Float64Array.from(r.parts,(e,t)=>Math.min((1900+j[t])**2,e.detail===1?1e4:e.detail===2?900:1/0)),ue=Float64Array.from(M,e=>e*e),de=Uint8Array.from(r.parts,e=>+(e.render===!1)|(e.emissive===0?0:2)),ne=Uint8Array.from(r.parts,e=>e.shape===`box`?0:e.shape===`cylinder`?2:e.shape===`sphere`?4:e.shape===`gable`?AC:6),te=Float32Array.from(r.parts,e=>(e.shape===`sphere`?Math.max(e.half[0],e.half[1],e.half[2]):Math.max(e.half[0],e.half[2]))**2),ie=new Int32Array(e.crowd.count).fill(-2),re=new Uint32Array(r.parts.length),E=[];let a=[];r.parts.forEach((e,t)=>(e.body<0?a:E).push(t)),m=a.length,Ce(t,e.crowd.count),we(t,r.parts.length+e.crowd.count),[...a,...E].forEach((e,t)=>{re[e]=t,Te(t*DC,r.parts[e])});let o=new Map;for(let e of a){let t=r.parts[e];if(t.render===!1)continue;let n=`${Math.floor(t.pos[0]/48)},${Math.floor(t.pos[2]/48)}`,i=o.get(n);i||o.set(n,i=[]),i.push(e)}A=[...o.values()].map(e=>{let t=1/0,n=1/0,i=1/0,a=-1/0,o=-1/0,s=-1/0;for(let c of e){let e=r.parts[c].pos,l=j[c];t=Math.min(t,e[0]-l),a=Math.max(a,e[0]+l),n=Math.min(n,e[1]-l),o=Math.max(o,e[1]+l),i=Math.min(i,e[2]-l),s=Math.max(s,e[2]+l)}return{ids:e,x:(t+a)/2,y:(n+o)/2,z:(i+s)/2,radius:Math.hypot(a-t,o-n,s-i)/2}}),D=[],O=[];for(let e of E){let t=r.parts[e];t.rayTrace!==!1&&t.detail===0&&(t.solid||t.emissive>0)&&(D.push(re[e]),O.push(xe(t)))}for(let t=0;t<e.crowd.count;t++)O.push({type:`capsule`,a:[0,0,0],b:[0,0,0],radius:.23,material:{albedo:[.2,.3,.4],roughness:.85,metalness:0}});v=e.crowd.pos.slice(),y=new Float64Array(e.crowd.count*4),b=new Float32Array(e.crowd.count*4);for(let t=0;t<e.crowd.count;t++)y[t*4+3]=1;S=new Float32Array(e.crowd.count*8),t.rt.setStatic(`park`,a.map(e=>r.parts[e]).filter(e=>e.rayTrace!==!1&&e.detail===0&&(e.solid||e.emissive>0)).map(xe)),r.parts.length&&t.device.queue.writeBuffer(i,0,s,0,r.parts.length*DC)},update(t,n){if(!e)return;let r=e,l=r.park,h=r.crowd;for(let e of g)e.length=0;for(let e=0;e<_.length;e++)r.bodyPose(e,r.renderTime,_[e]);for(let e of E){let t=re[e]*DC;be(l.parts[e]);for(let e=0;e<3;e++)s[t+16+e]=s[t+e],s[t+e]=fe[e];for(let e=0;e<4;e++)s[t+20+e]=s[t+4+e],s[t+4+e]=pe[e]}let M=n.camera.pos;ee(n.camera.quat,[1,0,0],_e),ee(n.camera.quat,[0,1,0],ve),ee(n.camera.quat,[0,0,-1],ye);let ae=Math.tan(n.camera.fovY/2),se=ae*n.camera.aspect,xe=Math.hypot(1,se),Se=Math.hypot(1,ae),Ce=(e,t,r,i)=>{e-=M[0],t-=M[1],r-=M[2];let a=e*ye[0]+t*ye[1]+r*ye[2];return a+i>n.camera.near&&Math.abs(e*_e[0]+t*_e[1]+r*_e[2])<a*se+i*xe&&Math.abs(e*ve[0]+t*ve[1]+r*ve[2])<a*ae+i*Se},we=e=>{let t=e.x-M[0],r=e.y-M[1],i=e.z-M[2],a=t*ye[0]+r*ye[1]+i*ye[2],o=e.radius;return a-o>n.camera.near&&Math.abs(t*_e[0]+r*_e[1]+i*_e[2])+o*xe<a*se&&Math.abs(t*ve[0]+r*ve[1]+i*ve[2])+o*Se<a*ae},Te=!1,Ee=n.height/(2*Math.tan(n.camera.fovY/2)),De=e=>(MC/((1-Math.cos(Math.PI/e))*Ee))**2,Oe=.2025/(n.height*n.height),ke=De(12),Ae=De(6);p=0;let je=M[0],Me=M[1],Ne=M[2],Pe=ye[0],Fe=ye[1],Ie=ye[2],Le=_e[0],Re=_e[1],ze=_e[2],Be=ve[0],Ve=ve[1],He=ve[2],Ue=n.camera.near,We=e=>{p++;let t=de[e];if(t&1)return;let n=re[e],r=n*DC,i=s[r]-je,a=s[r+1]-Me,o=s[r+2]-Ne,c=j[e];if(!Te){let e=i*Pe+a*Fe+o*Ie;if(!(e+c>Ue&&Math.abs(i*Le+a*Re+o*ze)<e*se+c*xe&&Math.abs(i*Be+a*Ve+o*He)<e*ae+c*Se))return}let l=i*i+a*a+o*o,u=Math.max(1,l);if(l>oe[e]||!(t&2)&&ue[e]<Oe*u)return;let d=ne[e],f=d>0&&d<8,m=f&&te[e]>ke*u,h=f?te[e]<Ae*u:l>12100;g[d===AC?AC:m?9+d/2:d+ +!!h].push(n)};for(let e of A)if(Ce(e.x,e.y,e.z,e.radius)){Te=we(e);for(let t of e.ids)We(t)}Te=!1;for(let e of E)We(e);u=g.reduce((e,t)=>e+t.length,0),d=0;let N=le((r.renderTime-(r.tick-1)*C)/C,0,1),Ge=0;for(let e=0;e<h.count;e++){let t=e*3,i=e*4,a=h.height[e],o=h.pos[t],c=h.pos[t+1],u=h.pos[t+2];if(!Ce(o,c,u,a))continue;let f=(o-M[0])**2+(c-M[1])**2+(u-M[2])**2;if(f>=81e4)continue;let p=h.previousSeatBlend[e]+N*(h.seatBlend[e]-h.previousSeatBlend[e]),m=h.mode[e]===k.Riding&&p===1,_=!m&&(h.seatBlend[e]>0||h.previousSeatBlend[e]>0);if(m){let t=r.guestSeat(e,ge,r.renderTime).rot;for(let e=0;e<4;e++)pe[e]=t[e];ee(t,[0,-T*a,0],fe);for(let e=0;e<3;e++)fe[e]+=ge.pos[e]}else if(_){let t=r.guestTransferPose(e,p,ge,r.renderTime);for(let e=0;e<4;e++)pe[e]=t.rot[e];for(let e=0;e<3;e++)fe[e]=t.pos[e]}else pe[0]=pe[2]=0,pe[1]=Math.sin(h.yaw[e]/2),pe[3]=Math.cos(h.yaw[e]/2);for(let e=0;e<3;e++)!m&&!_&&(fe[e]=h.previous[t+e]+N*(h.pos[t+e]-h.previous[t+e])),me[e]=v[t+e],v[t+e]=fe[e];for(let e=0;e<4;e++)he[e]=y[i+e];let C=ie[e]===n.frameIndex-1;if(!C){for(let e=0;e<3;e++)me[e]=fe[e];for(let e=0;e<4;e++)he[e]=pe[e]}ie[e]=n.frameIndex;let E=l.parts.length+d++,D=E*DC;g[f<225?kC:OC+ +(f>3025)].push(E),s.set(fe,D),s[D+3]=h.seatFront[e],s.set(pe,D+4),s[D+8]=s[D+9]=s[D+10]=a,s[D+11]=h.seatAngle[e],s[D+12]=h.tint[t],s[D+13]=h.tint[t+1],s[D+14]=h.tint[t+2],s[D+15]=h.straddle[e],s.set(me,D+16),s[D+19]=.3+e%17/24,s.set(he,D+20),y.set(pe,i);let O=ce(h.vel[t],h.vel[t+2],m);s[D+24]=r.renderTime+e*.71,s[D+25]=O,s[D+26]=p,s[D+27]=1;let A=!m&&!_&&h.stairFlight[e]>=0&&r.guestStairContacts(e,fe,r.renderTime,w);A&&(s[D+27]=2+Ge,x.set(w,Ge++*8));for(let e=0;e<4;e++)s[D+28+e]=C?b[i+e]:s[D+24+e];C&&b[i+3]>=2&&(s[D+31]=2+Ge,x.set(S.subarray(e*8,e*8+8),Ge++*8));for(let e=0;e<4;e++)b[i+e]=s[D+24+e];A&&S.set(w,e*8)}let Ke=0;for(let e of g)for(let t of e)c[Ke++]=t;let qe=(E.length+d)*DC;qe&&t.device.queue.writeBuffer(i,m*DC*4,s,m*DC,qe),Ke&&t.device.queue.writeBuffer(a,0,c,0,Ke),Ge&&t.device.queue.writeBuffer(o,0,x,0,Ge*8),f=qe*4+Ke*4+Ge*32;for(let e=0;e<D.length;e++){let t=O[e];if(!(`rot`in t)||!(`half`in t))continue;let n=D[e]*DC;for(let e=0;e<3;e++)t.center[e]=s[n+e];for(let e=0;e<4;e++)t.rot[e]=s[n+4+e]}for(let e=0;e<h.count;e++){let t=O[D.length+e];t.type===`capsule`&&r.guestCapsule(e,t.a,t.b,r.renderTime)}t.rt.setDynamic(`park-moving`,O)},encodeGBuffer(n){if(!e)return;n.setPipeline(t),n.setBindGroup(2,r);let i=0;for(let e=0;e<jC;e++){let t=g[e].length;t&&(n.setVertexBuffer(0,h[e].buffer),n.draw(h[e].count,t,0,i)),i+=t}},stats:()=>({visibleParts:u,visibleGuests:d,parts:e?.park.parts.length??0,guests:e?.crowd.count??0,uploadBytes:f,testedParts:p}),destroy(){for(let e of h)e.buffer.destroy();i?.destroy(),a?.destroy(),o?.destroy()}}}function PC(){return[qa(),If(),TC(),Lu(),NC(),af()]}var FC=32,IC=24,LC=6,RC=(e,t)=>Math.max(t,Math.round(e/2)*2);function zC(e){let t=.75;return{...e,giRays:1,rtMaxSteps:Math.max(FC,Math.round(e.rtMaxSteps*.67)),probes:{dim:[RC(e.probes.dim[0]*t,LC),RC(e.probes.dim[1]*t,LC),RC(e.probes.dim[2]*t,LC)],raysPerProbe:Math.max(IC,Math.round(e.probes.raysPerProbe/2)),spacing:Math.round(e.probes.spacing/t*2)/2},cloudSteps:Math.max(12,Math.round(e.cloudSteps*.6)),grassBladesPerM2:Math.round(e.grassBladesPerM2*.65),grassDistance:Math.round(e.grassDistance*.85),detailOctaves:Math.max(2,e.detailOctaves-1)}}function BC(e){let t=Wt(e.quality);return e.performance240?zC(t):t}function VC(e,t){return JSON.stringify(e)===JSON.stringify(t)}var HC=class{pending=0;maxPending=1;get ready(){return this.pending<this.maxPending}submitted(e){this.pending++,e.then(()=>{this.pending--},()=>{this.pending--})}},UC=class{statics=new Map;dynamics=new Map;staticCache=[];dynamicCache=[];staticDirty=!1;dynamicDirty=!1;ver=0;staticVer=0;get version(){return this.ver}get staticVersion(){return this.staticVer}setStatic(e,t){this.dynamics.delete(e)&&(this.dynamicDirty=!0),this.statics.set(e,t),this.staticDirty=!0,this.staticVer++,this.ver++}setDynamic(e,t){this.statics.delete(e)&&(this.staticDirty=!0,this.staticVer++),this.dynamics.set(e,t),this.dynamicDirty=!0,this.ver++}remove(e){let t=!1;this.statics.delete(e)&&(this.staticDirty=!0,this.staticVer++,t=!0),this.dynamics.delete(e)&&(this.dynamicDirty=!0,t=!0),t&&this.ver++}clear(){this.statics.size&&(this.staticDirty=!0,this.staticVer++),this.dynamics.size&&(this.dynamicDirty=!0),(this.statics.size||this.dynamics.size)&&this.ver++,this.statics.clear(),this.dynamics.clear()}allStatic(){return this.staticDirty&&=(this.flatten(this.statics,this.staticCache),!1),this.staticCache}allDynamic(){return this.dynamicDirty&&=(this.flatten(this.dynamics,this.dynamicCache),!1),this.dynamicCache}flatten(e,t){let n=0;for(let r of e.values())for(let e=0;e<r.length;e++)t[n++]=r[e];t.length=n}},WC=1.5,GC=6;function KC(e){let t=e>>>0;return()=>{t=t+1831565813>>>0;let e=Math.imul(t^t>>>15,1|t);return e=e+Math.imul(e^e>>>7,61|e)^e,((e^e>>>14)>>>0)/4294967296}}function qC(e,t){let n=e*e,r=e-1,i=Math.log2(e),a=new Uint8Array(n),o=new Float64Array(n),s=new Uint16Array(n),c=new Float64Array(169);for(let e=-6;e<=GC;e++)for(let t=-6;t<=GC;t++)c[(e+GC)*13+t+GC]=Math.exp(-(t*t+e*e)/(2*WC*WC));let l=new Float64Array(e),u=new Float64Array(e),d=new Int32Array(e),f=new Int32Array(e),p=new Uint8Array(e).fill(1),m=(t,n)=>{let a=t&r,s=t>>i;for(let t=-6;t<=GC;t++){let i=s+t&r,l=i*e,u=(t+GC)*13+GC;for(let e=-6;e<=GC;e++)o[l+(a+e&r)]+=n*c[u+e];p[i]=1}},h=()=>{for(let t=0;t<e;t++){if(!p[t])continue;p[t]=0;let n=-1/0,r=-1,i=1/0,s=-1;for(let c=t*e,l=c+e;c<l;c++){let e=o[c];a[c]?e>n&&(n=e,r=c):e<i&&(i=e,s=c)}l[t]=n,d[t]=r,u[t]=i,f[t]=s}},g=()=>{h();let t=-1,n=-1/0;for(let r=0;r<e;r++)l[r]>n&&(n=l[r],t=d[r]);return t},_=()=>{h();let t=-1,n=1/0;for(let r=0;r<e;r++)u[r]<n&&(n=u[r],t=f[r]);return t},v=KC(t),y=Math.round(n*.1);for(let e=0;e<y;){let t=Math.floor(v()*n);a[t]||(a[t]=1,m(t,1),e++)}for(let e=0;e<n;e++){let e=g();a[e]=0,m(e,-1);let t=_();if(a[t]=1,m(t,1),t===e)break}let b=a.slice(),x=y;for(;x>0;){let e=g();s[e]=--x,a[e]=0,m(e,-1)}a.set(b),o.fill(0),p.fill(1);for(let e=0;e<n;e++)a[e]&&m(e,1);for(x=y;x<n;x++){let e=_();s[e]=x,a[e]=1,m(e,1)}return s}var JC=null;function YC(){if(JC)return JC;let e=16384,t=qC(128,1374496523),n=qC(128,2654435769),r=new Uint8Array(e*2);for(let i=0;i<e;i++)r[i*2]=Math.min(255,Math.floor((t[i]+.5)/e*256)),r[i*2+1]=Math.min(255,Math.floor((n[i]+.5)/e*256));return JC=r,r}function XC(e,t){let n=[e];for(let e=t>>1,r=t;e>=1;r=e,e>>=1){let t=n[n.length-1],i=new Float32Array(e*e);for(let n=0;n<e;n++){let a=2*n*r,o=a+r;for(let r=0;r<e;r++){let s=t[a+2*r],c=t[a+2*r+1],l=t[o+2*r],u=t[o+2*r+1];i[n*e+r]=Math.max(Math.max(s,c),Math.max(l,u))}}n.push(i)}return n}function ZC(e){let t=Math.max(1,Math.floor(96/e)),n=[];for(let e=1;e<=t;e=e<4?e+1:Math.ceil(e*1.5))n.push(e);return n}function QC(e,t,n){let r=new Uint8Array(t*t*4),i=1/(2*n);for(let n=0;n<t;n++){let a=(n>0?n-1:0)*t,o=(n<t-1?n+1:t-1)*t;for(let s=0;s<t;s++){let c=s>0?s-1:0,l=s<t-1?s+1:t-1,u=(e[n*t+l]-e[n*t+c])*i*(s>0&&s<t-1?1:2),d=(e[o+s]-e[a+s])*i*(n>0&&n<t-1?1:2),f=1/Math.sqrt(u*u+1+d*d),p=(n*t+s)*4;r[p]=Math.round((-u*f*.5+.5)*255),r[p+1]=Math.round((f*.5+.5)*255),r[p+2]=Math.round((-d*f*.5+.5)*255)}}return $C(r,e,t,n),r}function $C(e,t,n,r){let i=ZC(r),a=i.length,o=new Int32Array(8),s=new Int32Array(8);[[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1],[0,-1],[1,-1]].forEach(([e,t],n)=>{o[n]=e,s[n]=t});let c=new Int32Array(8*a),l=new Float64Array(8*a);for(let e=0;e<8;e++)for(let t=0;t<a;t++)c[e*a+t]=s[e]*i[t]*n+o[e]*i[t],l[e*a+t]=1/(Math.hypot(o[e],s[e])*i[t]*r);let u=i[a-1];for(let r=0;r<n;r++)for(let d=0;d<n;d++){let f=r*n+d,p=t[f],m=0,h=d>=u&&r>=u&&d<n-u&&r<n-u;for(let e=0;e<8;e++){let u=0;if(h)for(let n=e*a,r=n+a;n<r;n++){let e=(t[f+c[n]]-p)*l[n];e>u&&(u=e)}else for(let c=0;c<a;c++){let f=Math.min(n-1,Math.max(0,d+o[e]*i[c])),m=(t[Math.min(n-1,Math.max(0,r+s[e]*i[c]))*n+f]-p)*l[e*a+c];m>u&&(u=m)}m+=u*u/(1+u*u)}e[f*4+3]=Math.round(Math.min(1,Math.max(0,1-m/8))*255)}}function ew(e,t){let n=new Uint8Array(t*t*4),r=e=>Math.round(Math.min(1,Math.max(0,e))*255);for(let i=0;i<t*t;i++)n[i*4]=r(e.soil[i]),n[i*4+1]=r(e.flow[i]),n[i*4+2]=r(e.deposit[i]),n[i*4+3]=r(e.wetness[i]);return n}function tw(e,t){return XC(e,t).map((e,n)=>{let r=Math.max(1,t>>n),i=new Float32Array(e.length);for(let t=0;t<r;t++){let n=t*r,a=Math.min(t+1,r-1)*r;for(let t=0;t<r;t++){let o=Math.min(t+1,r-1);i[n+t]=Math.max(Math.max(e[n+t],e[n+o]),Math.max(e[a+t],e[a+o]))}}return i})}var nw={width:256,height:64},rw={width:32,height:32},iw={width:192,height:108},aw={width:32,height:32,depth:32},ow=7,sw=31,cw=7;function lw(){let{width:e,height:t}=iw,n=new Uint16Array(e*t*4),r=[2400,5e3,12e3],i=[9e3,10500,12500];for(let a=0;a<t;a++){let o=(a+.5)/t,s=o<.5?1-o*2:0,c=o<.5?1:.3;for(let t=0;t<e;t++){let o=(a*e+t)*4;for(let e=0;e<3;e++)n[o+e]=Hi((i[e]+(r[e]-i[e])*s*s)*c);n[o+3]=Hi(1)}}return n}function uw(e,t){let n=new Uint16Array(e*4),r=t.map(Hi);for(let t=0;t<e;t++)n.set(r,t*4);return n}var dw=class{device;layout;group;tex;samplers;terrainN=0;constructor(e){this.device=e;let t=(e,t,n=`2d`)=>({binding:e,visibility:ow,texture:{sampleType:t,viewDimension:n}});this.layout=e.createBindGroupLayout({label:`world`,entries:[{binding:0,visibility:ow,sampler:{type:`filtering`}},{binding:1,visibility:ow,sampler:{type:`filtering`}},t(2,`unfilterable-float`),t(3,`unfilterable-float`),t(4,`float`),t(5,`float`),t(6,`float`),t(7,`float`),t(8,`float`),t(9,`float`,`3d`),t(10,`float`)]}),this.samplers={linearClamp:e.createSampler({label:`linearClamp`,magFilter:`linear`,minFilter:`linear`,mipmapFilter:`linear`,addressModeU:`clamp-to-edge`,addressModeV:`clamp-to-edge`,addressModeW:`clamp-to-edge`}),linearRepeat:e.createSampler({label:`linearRepeat`,magFilter:`linear`,minFilter:`linear`,mipmapFilter:`linear`,addressModeU:`repeat`,addressModeV:`repeat`,addressModeW:`repeat`})},this.tex={...this.createTerrainTextures(1),...this.createLuts(),blueNoise:this.createBlueNoise()},this.writePlaceholderTerrain(),this.rebuildGroup()}get terrainResolution(){return this.terrainN}rebuildGroup(){let e=this.tex;this.group=this.device.createBindGroup({label:`world`,layout:this.layout,entries:[{binding:0,resource:this.samplers.linearClamp},{binding:1,resource:this.samplers.linearRepeat},{binding:2,resource:e.terrainHeight.createView()},{binding:3,resource:e.terrainMaxPyr.createView()},{binding:4,resource:e.terrainNormal.createView()},{binding:5,resource:e.terrainMaps.createView()},{binding:6,resource:e.transmittance.createView()},{binding:7,resource:e.multiScatter.createView()},{binding:8,resource:e.skyView.createView()},{binding:9,resource:e.aerialPerspective.createView({dimension:`3d`})},{binding:10,resource:e.blueNoise.createView()}]})}uploadTerrain(e){let t=e.resolution;t!==this.terrainN&&(this.destroyTerrainTextures(),Object.assign(this.tex,this.createTerrainTextures(t)),this.rebuildGroup());let n=this.device.queue,r=this.tex;tw(e.height,t).forEach((e,i)=>{let a=Math.max(1,t>>i);n.writeTexture({texture:r.terrainMaxPyr,mipLevel:i},e,{bytesPerRow:a*4},{width:a,height:a})}),n.writeTexture({texture:r.terrainHeight},e.height,{bytesPerRow:t*4},{width:t,height:t}),n.writeTexture({texture:r.terrainNormal},QC(e.height,t,e.cellSize),{bytesPerRow:t*4},{width:t,height:t}),n.writeTexture({texture:r.terrainMaps},ew(e.maps,t),{bytesPerRow:t*4},{width:t,height:t}),this.terrainN=t}destroy(){this.destroyTerrainTextures();let e=this.tex;for(let t of[e.transmittance,e.multiScatter,e.skyView,e.aerialPerspective,e.blueNoise])t.destroy()}destroyTerrainTextures(){let e=this.tex;for(let t of[e.terrainHeight,e.terrainMaxPyr,e.terrainNormal,e.terrainMaps])t.destroy()}createTerrainTextures(e){let t=this.device,n=(n,r,i)=>t.createTexture({label:n,format:r,size:[e,e],mipLevelCount:i,usage:cw});return{terrainHeight:n(`terrainHeight`,`r32float`,1),terrainMaxPyr:n(`terrainMaxPyr`,`r32float`,Math.floor(Math.log2(e))+1),terrainNormal:n(`terrainNormal`,`rgba8unorm`,1),terrainMaps:n(`terrainMaps`,`rgba8unorm`,1)}}writePlaceholderTerrain(){let e=this.device.queue,t=this.tex;e.writeTexture({texture:t.terrainHeight},new Float32Array(1),{bytesPerRow:4},[1,1]),e.writeTexture({texture:t.terrainMaxPyr},new Float32Array(1),{bytesPerRow:4},[1,1]),e.writeTexture({texture:t.terrainNormal},new Uint8Array([128,255,128,255]),{bytesPerRow:4},[1,1]),e.writeTexture({texture:t.terrainMaps},new Uint8Array(4),{bytesPerRow:4},[1,1])}createLuts(){let e=this.device,t=e.queue,n=(n,r,i)=>{let a=r.depth?`3d`:`2d`,o=e.createTexture({label:n,dimension:a,format:`rgba16float`,size:[r.width,r.height,r.depth??1],usage:sw});return t.writeTexture({texture:o},i,{bytesPerRow:r.width*8,rowsPerImage:r.height},[r.width,r.height,r.depth??1]),o},r=nw,i=rw,a=aw;return{transmittance:n(`transmittanceLUT`,r,uw(r.width*r.height,[1,1,1,1])),multiScatter:n(`multiScatterLUT`,i,uw(i.width*i.height,[0,0,0,0])),skyView:n(`skyViewLUT`,iw,lw()),aerialPerspective:n(`aerialPerspectiveLUT`,a,uw(a.width*a.height*a.depth,[0,0,0,1]))}}createBlueNoise(){let e=this.device.createTexture({label:`blueNoise`,format:`rg8unorm`,size:[128,128],usage:cw});return this.device.queue.writeTexture({texture:e},YC(),{bytesPerRow:256},[128,128]),e}},fw=.1,pw=.25;function mw(e){return e.dynamicResolution&&!Ht(e.quality)}var hw=class e{canvas;post;options;rt=new UC;stats;device;errors=[];lost=null;onLost=null;adapter;rc;world;context;frameUniforms=new cr;exposure=new We;lightingCut=new Mn;scene=null;shaderSource=ge;dyn=new On;graph=new Un;timer;host;info={};uniformIn={};postParams={outWidth:0,outHeight:0,preExposure:1,prevPreExposure:1};reported=new Set;lighting;terrainInfo=null;last=null;outW;outH;frameIndex=-1;lastStart=0;destroyed=!1;errorCount=0;frameQueue=new HC;get frameReady(){return this.frameQueue.ready}static async create(t,n,r,i,a={}){let o=await en(),s=new e(t,n,o,r??PC(),i??Pt(),a);try{await s.init()}catch(e){throw s.destroy(),e}return s}constructor(e,t,n,r,i,a){this.canvas=e,this.post=i,this.options=a;let o=n.device;this.device=o,this.adapter=n.adapter,o.onuncapturederror=e=>this.report(`WebGPU uncaptured error: ${e.error.message}`),o.lost.then(e=>{e.reason!==`destroyed`&&(this.lost=`${e.reason}: ${e.message}`,this.timer.destroy(),this.report(`WebGPU device lost (${this.lost})`),this.onLost?.(e.reason,e.message))});let s=e.getContext(`webgpu`);if(!s)throw Error(`Could not create a WebGPU canvas context.`);this.context=s;let c=navigator.gpu.getPreferredCanvasFormat();s.configure({device:o,format:c,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC,alphaMode:`opaque`}),this.outW=Math.max(1,e.width),this.outH=Math.max(1,e.height),this.world=new dw(o),this.timer=new Rn(o,n.features.has(`timestamp-query`),a.gpuProfile),this.host=new yr(r,e=>this.report(e));let l=BC(t),u=lr(this.outW,this.outH,this.clampScale(t.renderScale),1),d=o.createBuffer({label:`frame uniforms`,size:768,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),f=GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT|GPUShaderStage.COMPUTE,p=o.createBindGroupLayout({label:`frame`,entries:[{binding:0,visibility:f,buffer:{type:`uniform`}}]});this.rc={...this.timer.detailed?{profiler:this.timer}:{},device:o,canvasFormat:c,features:n.features,frame:{layout:p,buffer:d,group:o.createBindGroup({label:`frame`,layout:p,entries:[{binding:0,resource:{buffer:d}}]})},world:this.world,gbuf:fr(o,u.width,u.height,l.rtDivisor),rt:this.rt,quality:l,settings:t,shader:(e,t)=>this.shaderSource(e,t),module:(e,t)=>this.createModule(e,t)},this.graph.bind(this.rc.gbuf),this.stats={frameIndex:0,cpuMs:0,gpuMs:null,fps:0,renderWidth:u.width,renderHeight:u.height,outWidth:this.outW,outHeight:this.outH,dynamicScale:1,preExposure:1,rtMs:null,adapter:n.adapterName,passMs:Nn.map(()=>NaN),displayHz:0,displaySource:`unknown`,targetFps:Dn(t.targetFps,0,t.frameCap),frameCap:t.frameCap,dynamicDriver:`off`,errorCount:0}}get totalErrorCount(){return this.errorCount}get gpuProfiling(){return{requested:this.options.gpuProfile===!0,supported:this.rc.features.has(`timestamp-query`),mode:this.timer.detailed?`detailed`:this.rc.features.has(`timestamp-query`)?`coarse`:`unsupported`}}listenGpuTimings(e){return this.timer.listen(e)}drainGpuTimings(e=5e3){return this.timer.drain(e)}get qualityProfile(){return this.rc.quality}async init(){await this.host.init(this.rc),await this.post.init(this.rc),this.post.resize(this.rc,{width:this.outW,height:this.outH}),this.lighting=new _r(this.rc,!this.host.drawsSky)}get initTimings(){return this.host.timings}setScene(e){this.scene=e,this.frameQueue.maxPending=e.park?2:1,this.lighting.setScene(e.park?.park);let t=e.terrain;this.world.uploadTerrain(t),this.terrainInfo={resolution:t.resolution,cellSize:t.cellSize,minHeight:t.minHeight,maxHeight:t.maxHeight,origin:t.origin},this.frameUniforms.resetHistory(),this.host.setScene(this.rc,e)}resetHistory(){this.frameIndex=-1,this.lastStart=0,this.last=null,this.lightingCut=new Mn,this.exposure.reset(),this.dyn.reset(),this.frameUniforms.resetHistory(),this.host.resetLighting(),this.post.resetHistory?.()}async replaceModules(e,t){t&&(this.shaderSource=t),await this.host.replace(this.rc,e,this.scene),this.retarget(!0)}rebind(){let e=this.rc.frame;e.group=this.device.createBindGroup({label:`frame`,layout:e.layout,entries:[{binding:0,resource:{buffer:e.buffer}}]}),this.retarget(!0)}async replaceStages(e){e.post&&(this.post.destroy?.(),this.post=e.post,await e.post.init(this.rc),e.post.resize(this.rc,{width:this.outW,height:this.outH})),e.lighting&&(this.lighting=new e.lighting(this.rc,!this.host.drawsSky),this.lighting.setScene(this.scene?.park?.park))}setSettings(e){let t=this.rc.settings,n=BC(e),r=!VC(n,this.rc.quality);this.rc.settings=e,r&&(this.rc.quality=n),(r||e.targetFps!==t.targetFps||e.frameCap!==t.frameCap||e.dynamicResolution!==t.dynamicResolution)&&this.dyn.reset(),this.retarget(r)}setDisplayRefresh(e,t=`unknown`){this.stats.displayHz=e,this.stats.displaySource=t,this.dyn.setMeasuredRefreshHz(e),this.dyn.reset()}simulateLoss(e){this.lost||this.destroyed||(this.lost=`unknown: ${e}`,this.timer.destroy(),this.report(`WebGPU device lost (${this.lost})`),this.onLost?.(`unknown`,e))}get displayPeriodMs(){return this.dyn.displayPeriodMs}resize(e,t,n){let r=this.device.limits.maxTextureDimension2D,i=Math.min(r,Math.max(1,Math.round(e*n))),a=Math.min(r,Math.max(1,Math.round(t*n)));i!==this.canvas.width&&(this.canvas.width=i),a!==this.canvas.height&&(this.canvas.height=a),this.outW=i,this.outH=a,this.retarget(!0)}render(e){if(this.destroyed||this.lost)return;let t=performance.now(),n=this.lastStart>0?t-this.lastStart:0;this.lastStart=t,this.last=e;try{this.encodeFrame(e,n,null)}catch(e){this.timer.abortFrame(),this.reportOnce(`render`,e)}this.stats.cpuMs=performance.now()-t}async capture(){if(!this.last)throw Error(`capture() called before the first render().`);let e=this.outW,t=this.outH,n=Math.ceil(e*4/256)*256,r=this.device.createBuffer({label:`capture`,size:n*t,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});try{this.encodeFrame(this.last,0,{buffer:r,bytesPerRow:n}),await r.mapAsync(GPUMapMode.READ);let i=new Uint8Array(r.getMappedRange()),a=new Uint8Array(e*t*4),o=this.rc.canvasFormat.startsWith(`bgra`);for(let r=0;r<t;r++){let t=r*n,s=r*e*4;for(let n=0;n<e;n++,t+=4,s+=4)a[s]=i[t+(o?2:0)],a[s+1]=i[t+1],a[s+2]=i[t+(o?0:2)],a[s+3]=255}return r.unmap(),{width:e,height:t,rgba:a}}finally{this.timer.abortFrame(),r.destroy()}}destroy(){this.destroyed||(this.destroyed=!0,this.host.destroy(),this.post.destroy?.(),this.lighting?.destroy(),this.timer.destroy(),mr(this.rc.gbuf),this.world.destroy(),this.rc.frame.buffer.destroy(),this.context.unconfigure(),this.device.destroy())}encodeFrame(e,t,n){let r=this.rc,i=r.settings;if(!n){this.frameIndex++;let n=e.camera.pos[1]+i.observer.altitudeM;this.lightingCut.step(e.astro,n)&&(this.exposure.reset(),this.host.resetLighting(),this.post.resetHistory?.()),this.exposure.update(e.dt,e.astro,n),this.dyn.update(this.timer.gpuMs,t,Dn(i.targetFps,this.stats.displayHz,i.frameCap),mw(i)),this.retarget(!1),this.updateStats(t)}let a=r.gbuf,o=r.quality,s=this.info;s.frameIndex=this.frameIndex,s.dt=e.dt,s.time=e.time,s.camera=e.camera,s.astro=e.astro,s.quad=e.quad,s.width=a.width,s.height=a.height;let c=this.uniformIn;c.camera=e.camera,c.astro=e.astro,c.dt=e.dt,c.time=e.time,c.frameIndex=this.frameIndex,c.width=a.width,c.height=a.height,c.preExposure=this.exposure.preExposure,c.observerAltitudeM=i.observer.altitudeM,c.jitter=o.taa,c.terrain=this.terrainInfo,c.qualityFlags=+!!o.rtSpecular|(o.bloom?2:0)|(o.taa?4:0),this.frameUniforms.write(c),this.device.queue.writeBuffer(r.frame.buffer,0,this.frameUniforms.buffer),this.host.update(r,s),this.post.update?.(r,s),this.timer.beginFrame(this.frameIndex,n!==null);let l=this.device.createCommandEncoder({label:`frame`}),u=this.context.getCurrentTexture(),d=this.postParams;d.outWidth=this.outW,d.outHeight=this.outH,d.preExposure=this.exposure.preExposure,d.prevPreExposure=this.exposure.prevPreExposure,this.graph.encode(l,r,this.host,this.lighting,this.post,this.timer,s,u.createView(),d),n&&l.copyTextureToBuffer({texture:u},{buffer:n.buffer,bytesPerRow:n.bytesPerRow},[this.outW,this.outH]),this.timer.resolve(l),this.device.queue.submit([l.finish()]),this.frameQueue.submitted(this.device.queue.onSubmittedWorkDone()),this.timer.afterSubmit()}retarget(e){let t=this.rc,n=t.gbuf,r=lr(this.outW,this.outH,this.clampScale(t.settings.renderScale),this.dyn.scale),i=n.rtWidth!==Math.ceil(r.width/t.quality.rtDivisor),a=r.width!==n.width||r.height!==n.height||i;(a||e)&&(a&&(t.gbuf=fr(this.device,r.width,r.height,t.quality.rtDivisor),mr(n),this.graph.bind(t.gbuf)),this.host.resize(t),this.lighting.rebuild(),this.post.resize(t,{width:this.outW,height:this.outH}))}updateStats(e){let t=this.stats,n=this.rc.gbuf;e>0&&(t.fps=t.fps===0?1e3/e:t.fps+(1e3/e-t.fps)*fw),t.frameIndex=this.frameIndex,t.gpuMs=this.timer.gpuMs,t.rtMs=this.host.tracesRays?this.timer.rtMs:null,t.renderWidth=n.width,t.renderHeight=n.height,t.outWidth=this.outW,t.outHeight=this.outH,t.dynamicScale=this.dyn.scale,t.preExposure=this.exposure.preExposure;let r=this.rc.settings;t.targetFps=Dn(r.targetFps,t.displayHz,r.frameCap),t.frameCap=r.frameCap,t.dynamicDriver=mw(r)?this.dyn.gpuDriven?`gpu`:`frame-time`:`off`,t.errorCount=this.errorCount;for(let e=0;e<t.passMs.length;e++)t.passMs[e]=this.timer.passMs[e]}clampScale(e){return Math.min(1,Math.max(pw,e))}createModule(e,t){let n=this.shaderSource(e,t),r=this.device.createShaderModule({label:e,code:n});return r.getCompilationInfo().then(t=>{let r=n.split(`
`);for(let n of t.messages){let t=`WGSL ${e}:${n.lineNum}:${n.linePos} ${n.message}\n    ${r[n.lineNum-1]??``}`;n.type===`error`?this.report(t):n.type===`warning`&&console.warn(t)}}),r}reportOnce(e,t){this.reported.has(e)||(this.reported.add(e),this.report(`renderer ${e} failed: ${t instanceof Error?t.stack??t.message:String(t)}`))}report(e){this.errorCount++,Jt(this.errors,e)}};export{Pt as _,Tv as a,If as c,au as d,ou as f,Bt as g,Nn as h,pv as i,af as l,Pn as m,NC as n,Q as o,qa as p,TC as r,tv as s,hw as t,Lu as u};