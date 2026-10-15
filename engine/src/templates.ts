// The model behind each prompt template's active version. There is no queryable object for templates, so this comes
// from a Metadata API retrieve of GenAiPromptTemplate, parsed here from the XML. The model name decides the prompt tier.
import { unzipSync, strFromU8 } from 'fflate';

export interface TemplateModel { name: string; model: string | null; type: string | null }

export function readTemplateModels(zipBase64: string): TemplateModel[] {
  const out: TemplateModel[] = [];
  for (const [path, bytes] of Object.entries(unzipSync(Buffer.from(zipBase64, 'base64')))) {
    if (!path.endsWith('.genAiPromptTemplate')) continue;
    out.push(templateModel(strFromU8(bytes), path.split('/').pop()!.replace(/\.genAiPromptTemplate$/, '')));
  }
  return out;
}

// The active version is named by activeVersionIdentifier; its primaryModel is the one that bills. Falls back to the
// newest published version when the identifier does not match, which happens when a template was never activated.
export function templateModel(xml: string, fallbackName: string): TemplateModel {
  const name = /<developerName>([^<]*)<\/developerName>/.exec(xml)?.[1] ?? fallbackName;
  const type = /<type>([^<]*)<\/type>/.exec(xml)?.[1] ?? null;
  const active = /<activeVersionIdentifier>([^<]*)<\/activeVersionIdentifier>/.exec(xml)?.[1];
  const versions = [...xml.matchAll(/<templateVersions>([\s\S]*?)<\/templateVersions>/g)].map((m) => ({
    id: /<versionIdentifier>([^<]*)<\/versionIdentifier>/.exec(m[1])?.[1],
    model: /<primaryModel>([^<]*)<\/primaryModel>/.exec(m[1])?.[1] ?? null,
    status: /<status>([^<]*)<\/status>/.exec(m[1])?.[1],
  }));
  const chosen = versions.find((v) => v.id && v.id === active) ?? [...versions].reverse().find((v) => v.status === 'Published') ?? versions[0];
  return { name, model: chosen?.model ?? null, type };
}
