import { expect, it } from 'vitest';
import { adamTickWgsl, adamWgsl } from '../gpu/nn';
import { DEFAULT_PPO, ppoOptimizerSettings } from './ppo';

it('keeps the original optimizer shaders exactly when new options are omitted', () => {
  const previous = { beta1: .9, beta2: .999, eps: 1e-5, maxNorm: .5 };
  const settings = ppoOptimizerSettings(DEFAULT_PPO);
  expect(adamTickWgsl(settings.adam)).toBe(adamTickWgsl(previous));
  expect(adamWgsl(256,0,settings.adam,252,settings.logStdMin,settings.logStdMax)).toBe(adamWgsl(256,0,previous,252,-3,.5));
});

it('uses custom Adam constants and exploration bounds in the generated GPU kernels', () => {
  const settings = ppoOptimizerSettings({...DEFAULT_PPO,adamBeta1:.8,adamBeta2:.95,adamEps:.0001,maxNorm:2,logStdMin:-2,logStdMax:1});
  expect(settings.adam).toEqual({beta1:.8,beta2:.95,eps:.0001,maxNorm:2});
  expect(adamTickWgsl(settings.adam)).not.toBe(adamTickWgsl(ppoOptimizerSettings(DEFAULT_PPO).adam));
  expect(adamWgsl(256,0,settings.adam,252,settings.logStdMin,settings.logStdMax)).toContain('clamp(p, -2.0, 1.0)');
});
