import { test } from 'node:test';
import assert from 'node:assert/strict';
import { templateModel } from '../src/templates.ts';

const xml = (active: string) => `<?xml version="1.0" encoding="UTF-8"?><GenAiPromptTemplate xmlns="http://soap.sforce.com/2006/04/metadata"><activeVersionIdentifier>${active}</activeVersionIdentifier><developerName>Interview_Score</developerName><masterLabel>Interview Score</masterLabel>
<templateVersions><primaryModel>sfdc_ai__DefaultGPT5Mini</primaryModel><status>Published</status><versionIdentifier>A=_1</versionIdentifier></templateVersions>
<templateVersions><primaryModel>sfdc_ai__DefaultBedrockAnthropicClaude45Haiku</primaryModel><status>Published</status><versionIdentifier>A=_3</versionIdentifier></templateVersions>
<type>einstein_gpt__flex</type></GenAiPromptTemplate>`;

test('the active version decides the model; without a match the newest published version does', () => {
  assert.deepEqual(templateModel(xml('A=_3'), 'x'), { name: 'Interview_Score', model: 'sfdc_ai__DefaultBedrockAnthropicClaude45Haiku', type: 'einstein_gpt__flex' });
  assert.equal(templateModel(xml('A=_1'), 'x').model, 'sfdc_ai__DefaultGPT5Mini');
  assert.equal(templateModel(xml('A=_9'), 'x').model, 'sfdc_ai__DefaultBedrockAnthropicClaude45Haiku', 'newest published');
});
