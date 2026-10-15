# Meter Check

See what will spend Flex Credits in your Salesforce org before you switch it on.

A free, open-source Chrome extension for Salesforce admins. It reads your org's setup through your own browser session and lists every flow, scheduled job, agent and Data 360 stream that Salesforce's published metering rules say will consume credits without a person clicking anything: what it is, why it is billed, roughly what it could cost each month, and the Setup page to change it.

**Status: pre-release.** The feasibility work is done and the first build is under way. Nothing here is on the Chrome Web Store yet.

## What it does not do

- It cannot cap or stop spending. Only Salesforce can do that. It warns.
- It reads setup data and metadata, never your records. Where a cost estimate needs a record count, it asks first and counts only.
- Nothing leaves your browser. There is no server, no account, no telemetry.
- Every estimate is labelled an estimate, with the rate card date it was checked against.

## Why

In August 2026 an admin switched on one AI feature and consumed about six million Flex Credits overnight, roughly $31,000 at list price, through Data 360 transforms. Salesforce's threshold alerts fired every day and stopped nothing. Every Salesforce tool for credits reports after the money is spent. Meter Check looks before.

## How it works

The same way Salesforce Inspector Reloaded does: the extension reads the session cookie for the Salesforce tab you have open and calls the REST, Tooling and Metadata APIs directly. No connected app, nothing installed in the org, no AppExchange package.

The rules it applies are Salesforce's own, from [Metering for Agentforce and Generative AI Usage](https://help.salesforce.com/s/articleView?id=ai.generative_ai_usage_metering_logic.htm&type=5), and the prices come from the [Flex Credits Rate Card](https://www.salesforce.com/en-us/wp-content/uploads/sites/4/assets/pdf/agentforce/Flex-Credits-Rate-Card-04.21.2026.pdf). Both are kept in one dated file in this repository.

## Repository

- `docs/plan.md`: the end-to-end plan, including what has been verified against real orgs and what has not.
- `spike/`: a minimal extension used to prove session and API access, including in orgs that sign in with passkeys. Not for release.

## Licence

MIT. Built by [Meet The Mind Technologies](https://meethemind.com), a registered Salesforce Consulting Partner. Salesforce, Agentforce and Data 360 are trademarks of Salesforce, Inc.; this project is not affiliated with or endorsed by Salesforce.
