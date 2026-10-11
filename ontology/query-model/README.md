# Query Model Ontology

Project-local, git-ignored ontology workspace for quotation/query-model analysis.

## Storage Contract

- `sources/**/raw/`: original source copy. Do not edit manually.
- `sources/**/normalized/`: graph input evidence documents.
- `sources/codebase/manifests/`: codebase graph/source manifests, not full source copies.
- `graph/`: deterministic artifacts generated from normalized evidence.
- `status/index-state.json`: stale/index status.

## Layers

- `domain`: ERP business-flow concepts used for cause analysis, such as `BizzType`, `BizzId`, `MenuType`, `Slip`, `SlipRelation`, `TransactionType`, `ProgressStatus`, `ReferAlias`, `PAttrValueOwner`, and `FailureSymptom`.
- `semantic`: 5.6 query-model/framework concepts that materialize the ERP flow, such as `ModelDefinition`, `ModelId`, `SearchModelDefinition`, `ComposableModel`, `RelationInfo`, `Relation`, `Repository`, `Material`, `Prop`, `Attribute`, `Mapper`, `Program`, `PCode`, and `AttributeP`.
- `code`: selected `CodeFile`, `CodeClass`, `CodeFunction`, `CodeCallsite`, and `DbTable` nodes extracted from or linked to repo/database implementation evidence.
- `evidence`: normalized session, board, docs, and codebase evidence.

Code nodes keep `owner_scope` so browser/shared/core paths can be reported as team request candidates instead of being treated as direct local edit targets.

## Naming Policy

- Choose layer node names from codebase terminology first.
- Before adding or renaming ontology node types, seed node ids, labels, or edge labels, search the current repo and `graphify-out` for existing identifiers.
- Prefer names that preserve code search keys. Example: use `SlipRelation` with labels `to_slip_relation / 불러온전표` and `slip_relation / 생성한전표`, and keep names such as `progress_status`, `refer_alias`, and `bd_data_conn_i` visible instead of replacing them with generalized English terms.
- For model concepts, keep the code/search terms visible: `ModelDefinition`, `SearchModelDefinition`, `quotationXlist_search`, `GetCustomizedSearchModelDefinition`, `CustomizedSearchModelProgram`, `ComposableModel`, `compose_models`, `Relation`, `relations`, `Repository`, and `repo_alias`.
- Use Korean business terms as labels or aliases when they help domain reading, but keep the implementation identifier visible when the concept maps to a code/refer_type/item_meaning id.
- If no codebase term exists, mark the name as provisional in the description or evidence rather than treating it as confirmed terminology.

## Pi Commands

```text
/ontology-ingest
/ontology-ingest pi [current|<jsonl>]
/ontology-ingest codex <jsonl>
/ontology-ingest claude <path>
/ontology-ingest cursor <path>
/ontology-ingest clipper [board-dir]
/ontology-ingest docs <path-or-url>
/ontology-ingest codebase [manifest]

/ontology-index
/ontology-query <question>
/ontology-status
/ontology-open
```

## Deterministic CLI

Pi commands delegate to:

```text
.pi/ontology/query-model/tools/ontology-cli.mjs
```

Direct usage:

```powershell
node .pi\ontology\query-model\tools\ontology-cli.mjs ingest codebase
node .pi\ontology\query-model\tools\ontology-cli.mjs ingest pi .pi\sessions\<session>.jsonl
node .pi\ontology\query-model\tools\ontology-cli.mjs ingest clipper
node .pi\ontology\query-model\tools\ontology-cli.mjs index
node .pi\ontology\query-model\tools\ontology-cli.mjs query "quotationXlist는 어떤 단계로 ModelDefinition이 되나?"
node .pi\ontology\query-model\tools\ontology-cli.mjs status
```

## HTML Generation

HTML generation is configured in `schema/ontology.json` under `html_generation`.

- `command`: direct regeneration command.
- `source_graph`: JSON graph artifact written by `index`.
- `output_html`: deterministic HTML artifact path.
- `output_report`: deterministic report artifact path.
- `renderer`: currently `inline-svg`; the graph JSON is embedded into the HTML, so no server is required.
- `layout`: fixed SVG viewport, node gaps, and node-type columns.

Current regeneration command:

```powershell
node .pi\ontology\query-model\tools\ontology-cli.mjs index
```

When `html_generation.deterministic` is `true`, the CLI uses a content hash `build_id` instead of wall-clock time for `generated_at`. With the same schema, seed data, normalized sources, codebase manifest/snapshot, P assets, and graphify snapshot, regenerated `graph/graph.html` should be byte-stable.

## Current v1 Limitation

v1 links normalized evidence to ontology nodes using deterministic keyword matching.
Important sessions should later be promoted into canonical LLM-reviewed evidence documents with confirmed cause, unresolved gaps, and reusable rules.
