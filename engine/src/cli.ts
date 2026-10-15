// Dev runner: node src/cli.ts <sf org alias>. Uses the sf CLI's own session; reads only.
import { readFlows, promptCalls } from './flows.ts';
import { readUnmetered } from './licence.ts';

const alias = process.argv[2];
if (!alias) { console.error('usage: node src/cli.ts <sf org alias>'); process.exit(2); }
// The sf CLI redacts tokens in its own output, so borrow its stored login through @salesforce/core, which also refreshes it.
const { AuthInfo, Connection, StateAggregator } = await import('@salesforce/core');
const username = (await StateAggregator.getInstance()).aliases.resolveUsername(alias);
const conn = await Connection.create({ authInfo: await AuthInfo.create({ username }) });
await conn.refreshAuth();
const s = { host: new URL(conn.instanceUrl).host, token: conn.accessToken! };

const t0 = Date.now();
const flows = await readFlows(s, (n, total) => { if (n % 20 === 0 || n === total) process.stderr.write(`  flows ${n}/${total}\n`); });
const calls = promptCalls(flows);
const licence = await readUnmetered(s);
console.log(`${alias}: ${flows.length} active flows read in ${((Date.now() - t0) / 1000).toFixed(1)}s; ${flows.filter((f) => f.prompts.length).length} call prompt templates`);
console.log(`unmetered licence: ${licence.exists ? `${licence.assigned} of ${licence.total} assigned (${licence.developerName})` : 'not in this org, so every prompt run is metered'}`);
for (const c of calls) console.log(`  ${c.runsAs === 'automated process' ? 'METERED ' : 'depends '} ${c.flow.label}: runs when ${c.flow.when}; calls ${c.template}${c.decisions.length ? ` only after the decision${c.decisions.length === 1 ? '' : 's'} ${c.decisions.join(', ')}` : ' on every run'} | ${c.why}`);
