// Publishes the built simulator (dist/, with the trained brains in dist/brains) to a VPS whose Caddy runs in Docker and is
// managed through Portainer. Static files go into the Caddy container's config volume; a site block for the host is added to
// the Caddyfile once (outside any generated block), validated, then Caddy is reloaded.
//
//   npm run build && node tools/deploy-vps.mjs            # upload, route, reload, check the public URL
//   node tools/deploy-vps.mjs --dry                        # only show what it found and would do
//
// Settings live outside the repo, in ~/.config/fpv-deploy/config.json:
//   { "portainer": "https://portainer.example", "endpoint": "local", "container": "caddy", "host": "fpv.example", "slug": "fpv" }
// Use an existing login via PORTAINER_PASSWORD or ~/.config/fpv-deploy/portainer-password (username in config.json),
// or an access token from PORTAINER_TOKEN or ~/.config/fpv-deploy/portainer-token. Credentials are never printed.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DIST = resolve(ROOT, 'dist');
const CONF_DIR = resolve(homedir(), '.config', 'fpv-deploy');
const dry = process.argv.includes('--dry');

const conf = JSON.parse(readFileSync(resolve(CONF_DIR, 'config.json'), 'utf8'));
const token = (process.env.PORTAINER_TOKEN ?? (existsSync(resolve(CONF_DIR, 'portainer-token')) ? readFileSync(resolve(CONF_DIR, 'portainer-token'), 'utf8') : '')).trim();
const savedPassword = conf.secretsFile && existsSync(conf.secretsFile)
  ? readFileSync(conf.secretsFile, 'utf8').split(/\r?\n/).find((line) => line.startsWith(`${conf.passwordKey ?? 'PT_PASS'}=`))?.split('=').slice(1).join('=').trim().replace(/^['"]|['"]$/g, '')
  : '';
const password = (process.env.PORTAINER_PASSWORD ?? (existsSync(resolve(CONF_DIR, 'portainer-password')) ? readFileSync(resolve(CONF_DIR, 'portainer-password'), 'utf8') : savedPassword ?? '')).trim();
if (!token && !password) throw new Error('Portainer access missing: provide the existing login password via PORTAINER_PASSWORD or ~/.config/fpv-deploy/portainer-password, or an existing access token');
for (const k of ['portainer', 'container', 'host', 'slug']) if (!conf[k]) throw new Error(`config.json needs "${k}"`);
if (!/^[a-z0-9-]+$/.test(conf.slug)) throw new Error('slug must be lower-case letters, digits and dashes');
if (!existsSync(resolve(DIST, 'index.html')) || !existsSync(resolve(DIST, 'brains', 'index.json'))) throw new Error('dist/ is missing or has no brains: run npm run build first');

const MARK = `# fpv-sim site (tools/deploy-vps.mjs)`;
let authHeaders;
if (token) {
  authHeaders = { 'X-API-Key': token };
} else {
  if (!conf.username) throw new Error('Portainer username missing: set "username" in ~/.config/fpv-deploy/config.json');
  const login = await fetch(`${conf.portainer}/api/auth`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ Username: conf.username, Password: password }),
  });
  if (!login.ok) throw new Error(`Portainer login failed: HTTP ${login.status}`);
  const { jwt } = await login.json();
  if (!jwt) throw new Error('Portainer login returned no session');
  authHeaders = { Authorization: `Bearer ${jwt}` };
}

async function api(path, init = {}) {
  const res = await fetch(`${conf.portainer}/api${path}`, { ...init, headers: { ...authHeaders, ...(init.headers ?? {}) } });
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path.replace(/\?.*/, '')}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res;
}

const endpoints = await (await api('/endpoints')).json();
const ep = endpoints.find((e) => e.Name === (conf.endpoint ?? 'local'));
if (!ep) throw new Error('Portainer has no environments');
const docker = (p, init) => api(`/endpoints/${ep.Id}/docker${p}`, init);
const containers = await (await docker('/containers/json?all=1')).json();
const box = containers.find((c) => c.Names.includes(`/${conf.container}`));
if (!box) throw new Error(`no container named ${conf.container}`);
const info = await (await docker(`/containers/${box.Id}/json`)).json();
const caddyfile = info.Mounts.find((m) => /Caddyfile$/.test(m.Destination))?.Destination ?? '/etc/caddy/Caddyfile';
const configDir = info.Mounts.find((m) => m.Destination === '/config')?.Destination;
if (!configDir) throw new Error(`${conf.container} has no /config volume`);
const siteDir = `${configDir}/sites/${conf.slug}`;

/** Runs a command in the Caddy container; returns { code, out }. */
async function exec(cmd) {
  const { Id } = await (await docker(`/containers/${box.Id}/exec`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ Cmd: cmd, AttachStdout: true, AttachStderr: true, Tty: true }),
  })).json();
  const out = await (await docker(`/exec/${Id}/start`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ Detach: false, Tty: true }) })).text();
  const { ExitCode } = await (await docker(`/exec/${Id}/json`)).json();
  return { code: ExitCode, out };
}

/** Puts a tar archive into the container at `dir`. */
async function untar(dir, tar) {
  await docker(`/containers/${box.Id}/archive?path=${encodeURIComponent(dir)}`, { method: 'PUT', headers: { 'Content-Type': 'application/x-tar' }, body: tar });
}

/** A tar holding one file. */
function tarOf(name, text) {
  const data = Buffer.from(text, 'utf8');
  const h = Buffer.alloc(512);
  h.write(name, 0, 'utf8');
  h.write('0000644\0', 100);
  h.write('0000000\0', 108);
  h.write('0000000\0', 116);
  h.write(`${data.length.toString(8).padStart(11, '0')}\0`, 124);
  h.write(`${Math.floor(Date.now() / 1000).toString(8).padStart(11, '0')}\0`, 136);
  h.write('        ', 148);
  h.write('0', 156);
  h.write('ustar\0', 257);
  h.write('00', 263);
  let sum = 0;
  for (const b of h) sum += b;
  h.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148);
  return Buffer.concat([h, data, Buffer.alloc((512 - (data.length % 512)) % 512), Buffer.alloc(1024)]);
}

const current = await exec(['cat', caddyfile]);
if (current.code !== 0) throw new Error(`cannot read ${caddyfile}`);
const text = current.out.replace(/\r\n/g, '\n');
const hasSite = text.includes(MARK);
console.log(`Portainer environment ${ep.Name} (${ep.Id}), container ${conf.container} (${box.State})`);
console.log(`Caddyfile ${caddyfile}; site addresses in it: ${[...text.matchAll(/^(\S[^\n{]*)\{\s*$/gm)].map((m) => m[1].trim()).join(', ')}`);
console.log(`site files -> ${siteDir}; route for https://${conf.host}/ ${hasSite ? 'already present' : 'will be added'}`);
if (dry) process.exit(0);

// 1. Files: a fresh copy of dist/.
const tar = spawnSync('tar', ['-cf', '-', '-C', DIST, '.'], { maxBuffer: 1 << 30 });
if (tar.status !== 0) throw new Error(`tar failed: ${tar.stderr}`);
const stage = `${siteDir}.new`;
let r = await exec(['sh', '-c', `rm -rf '${stage}' && mkdir -p '${stage}'`]);
if (r.code !== 0) throw new Error(`mkdir: ${r.out}`);
await untar(stage, tar.stdout);
r = await exec(['sh', '-c', `test -f '${stage}/index.html' && test -f '${stage}/brains/index.json' && rm -rf '${siteDir}.old' && { [ ! -d '${siteDir}' ] || mv '${siteDir}' '${siteDir}.old'; } && mv '${stage}' '${siteDir}' && rm -rf '${siteDir}.old'`]);
if (r.code !== 0) throw new Error(`swap: ${r.out}`);
console.log(`uploaded ${tar.stdout.length >> 10} KiB to ${siteDir}`);

// 2. Route: added once, outside any generated block, validated before it replaces the live Caddyfile.
if (!hasSite) {
  const block = [
    '', MARK, `${conf.host} {`, `\troot * ${siteDir}`, '\tencode zstd gzip',
    '\theader /assets/* Cache-Control "public, max-age=31536000, immutable"',
    '\t@fresh not path /assets/*', '\theader @fresh Cache-Control "no-cache"',
    '\tfile_server', '}', '',
  ].join('\n');
  const next = `${text.replace(/\n*$/, '\n')}${block}`;
  await untar('/tmp', tarOf('Caddyfile.fpv', next));
  r = await exec(['caddy', 'validate', '--config', '/tmp/Caddyfile.fpv', '--adapter', 'caddyfile']);
  if (r.code !== 0) throw new Error(`the new Caddyfile does not validate, nothing changed:\n${r.out.slice(-800)}`);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const mount = info.Mounts.find((m) => m.Destination === caddyfile);
  if (mount && !mount.RW) {
    const slash = mount.Source.lastIndexOf('/');
    const name = mount.Source.slice(slash + 1);
    const { Id: helper } = await (await docker('/containers/create', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ Image: info.Config.Image, Entrypoint: ['sh', '-c'],
        Cmd: [`cp '/work/${name}' '/work/${name}.bak.${stamp}' && printf '%s' "$CADDY_B64" | base64 -d > '/work/${name}'`],
        Env: [`CADDY_B64=${Buffer.from(next).toString('base64')}`],
        HostConfig: { NetworkMode: 'none', Binds: [`${mount.Source.slice(0, slash)}:/work`] } }),
    })).json();
    try {
      await docker(`/containers/${helper}/start`, { method: 'POST' });
      const result = await (await docker(`/containers/${helper}/wait?condition=not-running`, { method: 'POST' })).json();
      r = { code: result.StatusCode, out: 'host configuration helper failed' };
    } finally {
      await docker(`/containers/${helper}?force=1`, { method: 'DELETE' });
    }
  } else {
    r = await exec(['sh', '-c', `mkdir -p '${configDir}/backups' && cp '${caddyfile}' '${configDir}/backups/Caddyfile.${stamp}' && cat /tmp/Caddyfile.fpv > '${caddyfile}'`]);
  }
  if (r.code !== 0) throw new Error(`writing the Caddyfile: ${r.out}`);
  console.log('Caddyfile updated with a timestamped backup');
  r = await exec(['caddy', 'reload', '--config', caddyfile, '--adapter', 'caddyfile']);
  if (r.code !== 0) throw new Error(`caddy reload failed (the backup is in ${configDir}/backups):\n${r.out.slice(-800)}`);
  console.log('caddy reloaded');
}

// 3. Check the public site: the page, a script and the brains.
const url = `https://${conf.host}/`;
let ok = false;
for (let i = 0; i < 20 && !ok; i++) {
  try {
    const page = await fetch(url);
    const html = await page.text();
    const js = /src="\.?\/?(assets\/[^"]+\.js)"/.exec(html)?.[1];
    const brains = await (await fetch(`${url}brains/index.json`)).json();
    const asset = js ? await fetch(`${url}${js}`) : null;
    ok = page.ok && !!asset?.ok && Array.isArray(brains.brains) && brains.brains.length > 0;
    if (ok) console.log(`live: ${url} (page ${page.status}, ${js} ${asset.status}, brains: ${brains.brains.map((b) => b.name).join(', ')})`);
  } catch { /* the certificate may still be on its way */ }
  if (!ok) await new Promise((res) => setTimeout(res, 3000));
}
if (!ok) throw new Error(`${url} does not answer as expected yet`);
