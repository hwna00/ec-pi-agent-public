#!/usr/bin/env node
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const TOOL_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(TOOL_DIR, "..");
const PI_DIR = resolve(ROOT, "..", "..");
const PROJECT_ROOT = resolve(PI_DIR, "..");
const SOURCES_DIR = join(ROOT, "sources");
const GRAPH_DIR = join(ROOT, "graph");
const SCHEMA_PATH = join(ROOT, "schema", "ontology.json");
const STATUS_PATH = join(ROOT, "status", "index-state.json");
const P_ITEM_MEANING_PATH = join(
  PROJECT_ROOT,
  "@source",
  "server",
  "ecount",
  "@applications",
  "v56app",
  "asset",
  "p_executor",
  "item_meaning",
  "v_loc",
  "p_item_meaning.csv"
);
const ENUMS_PATH = join(PROJECT_ROOT, "@source", "@shared", "ecount", "@infra", "common@", "src", "@type", "types", "enum", "Enums.ts");
const ATTRIBUTE_P_CONTROLLER_DIR = join(PROJECT_ROOT, "@source", "@shared", "ecount", "@applications", "v56app@", "src", "pmodule", "p_executor", "attribute_data");

const SOURCE_PATHS = {
  pi: {
    raw: join(SOURCES_DIR, "conversations", "pi", "raw"),
    normalized: join(SOURCES_DIR, "conversations", "pi", "normalized")
  },
  codex: {
    raw: join(SOURCES_DIR, "conversations", "codex", "raw"),
    normalized: join(SOURCES_DIR, "conversations", "codex", "normalized")
  },
  claude: {
    raw: join(SOURCES_DIR, "conversations", "claude", "raw"),
    normalized: join(SOURCES_DIR, "conversations", "claude", "normalized")
  },
  cursor: {
    raw: join(SOURCES_DIR, "conversations", "cursor", "raw"),
    normalized: join(SOURCES_DIR, "conversations", "cursor", "normalized")
  },
  codebase: {
    manifests: join(SOURCES_DIR, "codebase", "manifests"),
    snapshots: join(SOURCES_DIR, "codebase", "snapshots"),
    normalized: join(SOURCES_DIR, "codebase", "normalized")
  },
  clipper: {
    raw: join(SOURCES_DIR, "clipper", "raw", "board-html"),
    normalized: join(SOURCES_DIR, "clipper", "normalized", "board-md")
  },
  docs: {
    raw: join(SOURCES_DIR, "docs", "raw"),
    normalized: join(SOURCES_DIR, "docs", "normalized")
  }
};

const DOMAIN_NODE_TYPES = new Set([
  "BizzType",
  "BizzId",
  "MenuType",
  "Slip",
  "SlipRelation",
  "TransactionType",
  "ProgressStatus",
  "ReferAlias",
  "PAttrValueOwner",
  "FailureSymptom"
]);
const SEMANTIC_NODE_TYPES = new Set([
  "ModelDefinition",
  "ModelId",
  "SearchModelDefinition",
  "ComposableModel",
  "MenuDefinition",
  "ModelFactoryRegistration",
  "DefinitionResolver",
  "CustomizedModelPipeline",
  "RelationInfo",
  "Relation",
  "Repository",
  "Material",
  "Prop",
  "Attribute",
  "Mapper",
  "Program",
  "FailureMode",
  "FailureCause",
  "PCode",
  "ItemMeaning",
  "AttributeP",
  "PValueOwner",
  "PValueController",
  "PExecutor"
]);

const SEED_NODES = [
  node("model-definition:quotationXlist", "$ModelDefinition / quotationXlist", "ModelDefinition", "runtime model definition produced for quotationXlist", "semantic"),
  node("model:quotationXlist", "quotationXlist", "ModelId", "quotation list model id", "semantic"),
  node("model:quotationXlist_search", "quotationXlist_search", "ModelId", "quotation search model id", "semantic"),
  node("search-model-definition:quotationXlist_search", "SearchModelDefinition / 검색창모델 / quotationXlist_search", "SearchModelDefinition", "search-window model definition for quotation list search conditions; code terms include GetCustomizedSearchModelDefinition and CustomizedSearchModelProgram", "semantic"),
  node("model:static∬quotationXlist", "static∬quotationXlist", "ModelId", "static quotation list model id", "semantic"),
  node("composable-model:InventoryListComposableModel", "InventoryListComposableModel", "ComposableModel", "composable model used as a source for inventory quotation list model composition", "semantic"),
  node("composable-model:compose_models", "compose_models", "ComposableModel", "relation_info compose_models list that contributes props into the resulting ModelDefinition", "semantic"),
  node("menu:IMenuDefinition.model_info_list", "IMenuDefinition.model_info_list", "MenuDefinition", "menu model declaration surface", "semantic"),
  node("factory:dynamic-registration", "dynamic model factory registration", "ModelFactoryRegistration", "dynamic model resolver registration", "semantic"),
  node("factory:static-registration", "static model factory registration", "ModelFactoryRegistration", "static model resolver registration", "semantic"),
  node("resolver:context.definition.get", "context.definition.get", "DefinitionResolver", "runtime definition resolver entry", "semantic"),
  node("resolver:CtxDefinitionResolver", "CtxDefinitionResolver", "DefinitionResolver", "definition resolver implementation", "semantic"),
  node("pipeline:customized-model", "CustomizedModelPipeline", "CustomizedModelPipeline", "relation fetch, child registration, target props, material creation, active props", "semantic"),
  node("relation:quotation-list", "quotation list relation_info", "RelationInfo", "base model, compose model, relations, flatten targets, child materials", "semantic"),
  node("model-relation:relations", "relations", "Relation", "relation_info relations entry that becomes Relation props in ModelDefinition", "semantic"),
  node("model-relation:relation-prop", "type.Relation", "Relation", "ModelDefiner relation prop declaration surface", "semantic"),
  node("repository:main", "main repository", "Repository", "main repository used by quotation list model data source and prop activation", "semantic"),
  node("repository:repo_alias", "repo_alias", "Repository", "repository alias used to bind relation/source columns to props", "semantic"),
  node("repository:json-repo", "json repo", "Repository", "in-memory/json repository source used for dynamically supplied model data", "semantic"),
  node("material:master", "master material", "Material", "master model material", "semantic"),
  node("material:detail", "detail material", "Material", "detail model material", "semantic"),
  node("material:exported", "exported material", "Material", "exported model material", "semantic"),
  node("material:temp-count", "temp count material", "Material", "count/temp model material", "semantic"),
  node("prop:target", "target prop", "Prop", "visible target prop", "semantic"),
  node("prop:relation", "relation prop", "Prop", "prop sourced from relation", "semantic"),
  node("prop:conn_data", "conn_data prop", "Prop", "connection data prop", "semantic"),
  node("prop:mandatory", "mandatory prop", "Prop", "mandatory prop activated into model", "semantic"),
  node("attr:bizz", "bizz attr", "Attribute", "business-level attribute", "semantic"),
  node("attr:prop", "prop attr", "Attribute", "property-level attribute", "semantic"),
  node("attr:search", "search attr", "Attribute", "search condition attribute", "semantic"),
  node("mapper:read-request", "read request mapper", "Mapper", "generic search dto to read request mapper", "semantic"),
  node("mapper:quotation", "quotation-specific mapper", "Mapper", "quotation-specific request mapping", "semantic"),
  node("program:SearchProgram2", "SearchProgram2", "Program", "search execution program", "semantic"),
  node("program:upstream-action", "upstream search action", "Program", "action that invokes search program", "semantic"),
  node("failure:missing-prop", "missing prop", "FailureMode", "target prop is absent from result/model", "semantic"),
  node("failure:wrong-relation", "wrong relation", "FailureMode", "relation_info or mapping points to wrong relation", "semantic"),
  node("failure:wrong-mapper", "wrong mapper", "FailureMode", "search dto is mapped incorrectly", "semantic"),
  node("failure:stale-cache", "stale cache", "FailureMode", "definition/cache is stale", "semantic"),
  node("failure:wrong-target", "wrong target", "FailureMode", "target model/material is wrong", "semantic"),
  node("failure:unsupported-comparator", "unsupported comparator", "FailureMode", "search comparator/type map path unsupported", "semantic"),
  node("pexecutor:main-item-meaning", "MainItemMeaningPExecutor", "PExecutor", "resolves item_meaning P-code matrix", "semantic"),
  node("pexecutor:attribute-data", "AttributeDataPExecutor", "PExecutor", "resolves attribute P value owners/controllers/search order", "semantic"),
  node("pvaluecontroller:attribute", "Attribute PValueController", "PValueController", "attribute P value controller family", "semantic"),
  node("biztype:inventory", "Inventory", "BizzType", "재고 업무군", "domain"),
  node("bizzid:quotation", "quotation", "BizzId", "견적 업무", "domain"),
  node("bizzid:sales", "sales", "BizzId", "판매 업무", "domain"),
  node("bizzid:shipping-order", "shipping_order", "BizzId", "출하지시 업무", "domain"),
  node("menutype:input", "Input", "MenuType", "입력 메뉴 타입", "domain"),
  node("menutype:list", "List", "MenuType", "조회 메뉴 타입", "domain"),
  node("menutype:status", "Status", "MenuType", "현황 메뉴 타입", "domain"),
  node("menutype:exported", "Exported", "MenuType", "내보내기 메뉴 타입", "domain"),
  node("slip:quotation", "견적 전표", "Slip", "quotation bizz document/slip", "domain"),
  node("slip-relation:to_slip_relation", "to_slip_relation / 불러온전표", "SlipRelation", "refer_type to_slip_relation maps to from_data, shown as 불러온전표", "domain"),
  node("slip-relation:slip_relation", "slip_relation / 생성한전표", "SlipRelation", "refer_type slip_relation maps to to_data, shown as 생성한전표", "domain"),
  node("transaction-type:relation", "거래형", "TransactionType", "업무 간 거래/참조 관계형 설정", "domain"),
  node("progress-status:progress_status", "progress_status / 진행상태", "ProgressStatus", "progress_status item meaning and business status concept", "domain"),
  node("refer-alias:refer_alias", "refer_alias / 출처 표시", "ReferAlias", "refer_alias source marker used in 5.0 compatibility discussions and query-model gap analysis", "domain"),
  node("dbtable:bd_data_conn_i", "bd_data_conn_i", "DbTable", "DB table for connected business document relation bridge data", "code"),
  node("pattr-value-owner:bizz", "EN_P_ATTR_VALUE_OWNER.bizz / 업무설정", "PAttrValueOwner", "P attribute value owner for bizz-level setup", "domain"),
  node("pattr-value-owner:bizz_item", "EN_P_ATTR_VALUE_OWNER.bizz_item / 항목설정", "PAttrValueOwner", "P attribute value owner for bizz item setup", "domain"),
  node("pattr-value-owner:template_item", "EN_P_ATTR_VALUE_OWNER.template_item / 양식설정", "PAttrValueOwner", "P attribute value owner for template item setup", "domain"),
  node("symptom:item-not-visible", "항목이 안 보임", "FailureSymptom", "visible item/column is missing from query result", "domain"),
  node("symptom:search-condition-not-working", "검색 조건이 동작하지 않음", "FailureSymptom", "search condition does not affect result", "domain"),
  node("symptom:transaction-field-not-visible", "거래형 항목이 안 보임", "FailureSymptom", "transaction relation field is missing", "domain"),
  node("symptom:exported-field-shortage", "내보내기 항목이 부족함", "FailureSymptom", "exported model has fewer visible props than expected", "domain")
];

const SEED_EDGES = [
  edge("menu:IMenuDefinition.model_info_list", "model:quotationXlist", "declares", "seed", "default quotation trace"),
  edge("menu:IMenuDefinition.model_info_list", "model:quotationXlist_search", "declares", "seed", "default quotation trace"),
  edge("factory:dynamic-registration", "model:quotationXlist", "registers", "seed", "default quotation trace"),
  edge("factory:static-registration", "model:static∬quotationXlist", "registers", "seed", "default quotation trace"),
  edge("model:quotationXlist", "resolver:context.definition.get", "resolves_to", "seed", "default quotation trace"),
  edge("model:quotationXlist_search", "resolver:context.definition.get", "resolves_to", "seed", "default quotation trace"),
  edge("model:quotationXlist_search", "search-model-definition:quotationXlist_search", "resolves_to", "seed", "quotationXlist_search resolves to the search-window model definition"),
  edge("search-model-definition:quotationXlist_search", "attr:search", "activates", "seed", "search model exposes search condition attributes"),
  edge("search-model-definition:quotationXlist_search", "model-definition:quotationXlist", "maps_search_condition", "board", "search-window model maps to grid model through item_meaning_id based prop lookup"),
  edge("search-model-definition:quotationXlist_search", "mapper:read-request", "maps_request", "seed", "search model contributes conditions to read request mapping"),
  edge("model:quotationXlist", "model-definition:quotationXlist", "resolves_to", "seed", "model id resolves to runtime $ModelDefinition"),
  edge("model-definition:quotationXlist", "material:master", "materialized_as", "seed", "$ModelDefinition is materialized through model materials"),
  edge("resolver:context.definition.get", "resolver:CtxDefinitionResolver", "resolves_to", "seed", "default quotation trace"),
  edge("resolver:CtxDefinitionResolver", "pipeline:customized-model", "builds", "seed", "default quotation trace"),
  edge("pipeline:customized-model", "relation:quotation-list", "uses_relation_info", "seed", "default quotation trace"),
  edge("relation:quotation-list", "composable-model:InventoryListComposableModel", "has_base_model", "seed", "relation_info base_model points to a composable/base model"),
  edge("relation:quotation-list", "composable-model:compose_models", "has_compose_model", "seed", "relation_info compose_models contributes additional model parts"),
  edge("composable-model:InventoryListComposableModel", "model-definition:quotationXlist", "composes", "seed", "composable model contributes to final quotationXlist ModelDefinition"),
  edge("composable-model:compose_models", "model-definition:quotationXlist", "composes", "seed", "compose_models contributes to final quotationXlist ModelDefinition"),
  edge("relation:quotation-list", "model-relation:relations", "defines_relation", "seed", "relation_info relations define relation entries"),
  edge("model-relation:relations", "model-relation:relation-prop", "materialized_as", "seed", "relations materialize as type.Relation declarations"),
  edge("model-relation:relation-prop", "prop:relation", "materialized_as", "seed", "type.Relation produces relation props"),
  edge("model-definition:quotationXlist", "repository:main", "uses_repository", "seed", "$ModelDefinition reads model data through the main repository"),
  edge("composable-model:InventoryListComposableModel", "repository:main", "uses_repository", "seed", "InventoryListComposableModel is backed by repository sources"),
  edge("composable-model:InventoryListComposableModel", "repository:json-repo", "uses_repository", "seed", "composable model can use json repo for dynamic data sources"),
  edge("repository:main", "repository:repo_alias", "has_repo_alias", "seed", "repo_alias names repository columns and relation sources"),
  edge("repository:repo_alias", "prop:relation", "materialized_as", "seed", "repo_alias participates in relation prop mapping"),
  edge("repository:repo_alias", "prop:target", "materialized_as", "seed", "repo_alias participates in target prop mapping"),
  edge("relation:quotation-list", "material:master", "builds", "seed", "default quotation trace"),
  edge("relation:quotation-list", "material:detail", "builds", "seed", "default quotation trace"),
  edge("relation:quotation-list", "material:exported", "builds", "seed", "default quotation trace"),
  edge("relation:quotation-list", "prop:relation", "flattens", "seed", "default quotation trace"),
  edge("prop:target", "material:master", "activates", "seed", "default quotation trace"),
  edge("prop:mandatory", "material:master", "activates", "seed", "default quotation trace"),
  edge("attr:search", "mapper:read-request", "maps_request", "seed", "default quotation trace"),
  edge("mapper:read-request", "mapper:quotation", "maps_request", "seed", "default quotation trace"),
  edge("mapper:quotation", "program:SearchProgram2", "executes", "seed", "default quotation trace"),
  edge("program:upstream-action", "program:SearchProgram2", "executes", "seed", "default quotation trace"),
  edge("failure:missing-prop", "prop:target", "causes", "seed", "prop not visible in target/result"),
  edge("failure:wrong-relation", "relation:quotation-list", "causes", "seed", "relation target mismatch"),
  edge("failure:wrong-mapper", "mapper:quotation", "causes", "seed", "request mapping mismatch"),
  edge("failure:stale-cache", "resolver:context.definition.get", "causes", "seed", "definition cache mismatch"),
  edge("failure:wrong-target", "material:exported", "causes", "seed", "wrong model/material selected"),
  edge("failure:unsupported-comparator", "attr:search", "causes", "seed", "search comparator path unsupported"),
  edge("symptom:item-not-visible", "failure:missing-prop", "caused_by", "seed", "visible item is often narrowed through prop activation and P availability"),
  edge("symptom:item-not-visible", "failure:wrong-target", "caused_by", "seed", "wrong material/model can hide otherwise valid props"),
  edge("symptom:search-condition-not-working", "failure:wrong-mapper", "caused_by", "seed", "search dto can be dropped or mapped to wrong read request"),
  edge("symptom:search-condition-not-working", "failure:unsupported-comparator", "caused_by", "seed", "renderer/item_set/typemap/comparator path may be unsupported"),
  edge("symptom:transaction-field-not-visible", "failure:wrong-relation", "caused_by", "seed", "relation_info controls relation field flattening"),
  edge("symptom:exported-field-shortage", "failure:missing-prop", "caused_by", "seed", "exported props can be hidden by P availability or target props"),
  edge("symptom:exported-field-shortage", "failure:wrong-target", "caused_by", "seed", "exported request can resolve to the wrong material"),
  edge("pexecutor:main-item-meaning", "prop:target", "activates", "seed", "P-code matrix controls item_meaning availability"),
  edge("pexecutor:attribute-data", "attr:prop", "activates_attribute", "seed", "attribute P controls attribute value lookup"),
  edge("pexecutor:attribute-data", "pvaluecontroller:attribute", "controlled_by", "seed", "attribute data executor uses P value controllers"),
  edge("biztype:inventory", "bizzid:quotation", "has_bizz_id", "seed", "Inventory contains quotation bizz id"),
  edge("biztype:inventory", "bizzid:sales", "has_bizz_id", "seed", "Inventory contains sales bizz id"),
  edge("biztype:inventory", "bizzid:shipping-order", "has_bizz_id", "seed", "Inventory contains shipping order bizz id"),
  edge("bizzid:quotation", "biztype:inventory", "belongs_to_bizz_type", "seed", "quotation belongs to Inventory"),
  edge("bizzid:quotation", "menutype:input", "has_menu_type", "seed", "quotation input"),
  edge("bizzid:quotation", "menutype:list", "has_menu_type", "seed", "quotation list/search"),
  edge("bizzid:quotation", "menutype:status", "has_menu_type", "seed", "quotation status"),
  edge("bizzid:quotation", "menutype:exported", "has_menu_type", "seed", "quotation exported"),
  edge("bizzid:quotation", "slip:quotation", "has_slip", "seed", "quotation bizz manages quotation slips"),
  edge("slip:quotation", "slip-relation:to_slip_relation", "has_slip_relation", "seed", "quotation slip can expose to_slip_relation / 불러온전표"),
  edge("slip:quotation", "slip-relation:slip_relation", "has_slip_relation", "seed", "quotation slip can expose slip_relation / 생성한전표"),
  edge("slip-relation:to_slip_relation", "relation:quotation-list", "represented_by", "seed", "to_slip_relation is implemented through relation_info in query-model analysis"),
  edge("slip-relation:slip_relation", "relation:quotation-list", "represented_by", "seed", "slip_relation is implemented through relation_info in query-model analysis"),
  edge("slip-relation:to_slip_relation", "prop:relation", "materialized_as", "seed", "to_slip_relation appears as relation props"),
  edge("slip-relation:slip_relation", "prop:relation", "materialized_as", "seed", "slip_relation appears as relation props"),
  edge("bizzid:quotation", "model:quotationXlist", "represented_by", "seed", "quotation list business flow is represented by quotationXlist"),
  edge("bizzid:quotation", "model:quotationXlist_search", "represented_by", "seed", "quotation search business flow is represented by quotationXlist_search"),
  edge("bizzid:quotation", "model:static∬quotationXlist", "represented_by", "seed", "static quotation list business flow is represented by static model id"),
  edge("menutype:list", "model:quotationXlist", "represented_by", "seed", "List menu type is represented by quotationXlist"),
  edge("menutype:list", "model:quotationXlist_search", "searched_by", "seed", "List search behavior is represented by quotationXlist_search"),
  edge("menutype:exported", "material:exported", "materialized_as", "seed", "Exported menu type materializes as exported material"),
  edge("pattr-value-owner:bizz", "attr:bizz", "configured_by", "seed", "EN_P_ATTR_VALUE_OWNER.bizz configures bizz attributes"),
  edge("pattr-value-owner:bizz_item", "attr:prop", "configured_by", "seed", "EN_P_ATTR_VALUE_OWNER.bizz_item configures bizz item prop attributes"),
  edge("pattr-value-owner:template_item", "attr:prop", "configured_by", "seed", "EN_P_ATTR_VALUE_OWNER.template_item configures template item prop attributes"),
  edge("prop:target", "menutype:list", "exposed_as", "seed", "target prop becomes visible in list menu"),
  edge("relation:quotation-list", "transaction-type:relation", "uses_transaction_type", "seed", "relation_info handles transaction-type relations"),
  edge("bizzid:quotation", "progress-status:progress_status", "has_item_meaning", "seed", "quotation query model exposes progress_status as a business status item"),
  edge("progress-status:progress_status", "prop:target", "materialized_as", "seed", "progress_status materializes as target/query props"),
  edge("refer-alias:refer_alias", "prop:relation", "materialized_as", "seed", "refer_alias identifies relation/source provenance for flattened relation props"),
  edge("transaction-type:relation", "refer-alias:refer_alias", "represented_by", "seed", "transaction-type relation analysis often requires refer_alias/source provenance"),
  edge("transaction-type:relation", "dbtable:bd_data_conn_i", "implemented_by", "seed", "bd_data_conn_i stores bridge rows for transaction-type connected business documents"),
  edge("dbtable:bd_data_conn_i", "relation:quotation-list", "implemented_by", "seed", "quotation relation_info can be backed by bd_data_conn_i bridge data"),
  edge("pattr-value-owner:bizz", "pvalueowner:bizz", "maps_to_owner", "seed", "domain bizz owner maps to semantic PValueOwner bizz"),
  edge("pattr-value-owner:bizz_item", "pvalueowner:bizz_item", "maps_to_owner", "seed", "domain bizz_item owner maps to semantic PValueOwner bizz_item"),
  edge("pattr-value-owner:template_item", "pvalueowner:template_item", "maps_to_owner", "seed", "domain template_item owner maps to semantic PValueOwner template_item"),
  edge("pattr-value-owner:bizz", "attributep:bizz", "scopes_attribute", "seed", "EN_P_ATTR_VALUE_OWNER.bizz scopes bizz AttributeP"),
  edge("pattr-value-owner:bizz_item", "attributep:bizz_item", "scopes_attribute", "seed", "EN_P_ATTR_VALUE_OWNER.bizz_item scopes bizz_item AttributeP"),
  edge("pattr-value-owner:template_item", "attributep:template_item", "scopes_attribute", "seed", "EN_P_ATTR_VALUE_OWNER.template_item scopes template_item AttributeP")
];

const MATCHERS = [
  ["search-model-definition:quotationXlist_search", ["검색창모델", "검색창 모델", "search model definition", "searchmodeldefinition", "getcustomizedsearchmodeldefinition", "customizedsearchmodelprogram", "invsearchmodel", "depends", "item meaning based mapping"]],
  ["model:quotationXlist_search", ["quotationxlist_search", "quotationxlist search"]],
  ["model:quotationXlist", ["quotationxlist", "quotation list"]],
  ["model:static∬quotationXlist", ["static∬quotationxlist", "static quotationxlist"]],
  ["model-definition:quotationXlist", ["$modeldefinition", "modeldefinition", "model definition", "modeldefinition / quotationxlist"]],
  ["composable-model:InventoryListComposableModel", ["inventorylistcomposablemodel", "composable model", "composablemodel"]],
  ["composable-model:compose_models", ["compose_models", "compose model", "compose_models list"]],
  ["model-relation:relations", ["relations", "relation entry", "irelationinfo"]],
  ["model-relation:relation-prop", ["type.relation", "relation prop declaration", "defineprop relation"]],
  ["repository:main", ["main repository", "repository", "model repository"]],
  ["repository:repo_alias", ["repo_alias", "repo alias", "repository alias"]],
  ["repository:json-repo", ["json repo", "json repository", "viewerwithjson"]],
  ["menu:IMenuDefinition.model_info_list", ["imenudefinition", "model_info_list", "menu definition"]],
  ["factory:dynamic-registration", ["dynamic registration", "dynamic model", "factory registration"]],
  ["factory:static-registration", ["static registration", "static model"]],
  ["resolver:context.definition.get", ["context.definition.get", "definition.get"]],
  ["resolver:CtxDefinitionResolver", ["ctxdefinitionresolver"]],
  ["pipeline:customized-model", ["customizedmodel", "customized model", "relation fetch", "active props", "target props"]],
  ["relation:quotation-list", ["relation_info", "relation info", "compose model", "flatten target"]],
  ["material:master", ["master material", "master model"]],
  ["material:detail", ["detail material", "detail model"]],
  ["material:exported", ["exported", "xexported", "export model"]],
  ["material:temp-count", ["temp count", "count model"]],
  ["prop:target", ["target prop", "target_props", "target prop"]],
  ["prop:relation", ["relation prop", "repo_alias", "source:"]],
  ["prop:conn_data", ["conn_data", "connection data"]],
  ["prop:mandatory", ["mandatory", "required prop"]],
  ["attr:bizz", ["bizz attr", "bizz_sid"]],
  ["attr:prop", ["prop attr", "attribute"]],
  ["attr:search", ["search attr", "search condition", "comparator", "renderer", "item_set", "typemap"]],
  ["mapper:read-request", ["readrequestmapper", "read request mapper", "inventoryreadrequestmapperfactory"]],
  ["mapper:quotation", ["quotation mapper", "quotation-specific mapper"]],
  ["program:SearchProgram2", ["searchprogram2"]],
  ["program:upstream-action", ["selectinventorysearchlistaction", "search action", "upstream action"]],
  ["failure:missing-prop", ["missing prop", "누락", "안 들어", "안나", "blank", "빈값"]],
  ["failure:wrong-relation", ["wrong relation", "relation 처리", "relation 오작동"]],
  ["failure:wrong-mapper", ["wrong mapper", "mapper", "매퍼"]],
  ["failure:stale-cache", ["stale cache", "cache", "캐시"]],
  ["failure:wrong-target", ["wrong target", "target 잘못", "라우팅"]],
  ["failure:unsupported-comparator", ["unsupported comparator", "comparator", "검색 조건"]],
  ["pexecutor:main-item-meaning", ["p_item_meaning", "mainitemmeaningpexecutor", "item meaning p"]],
  ["pexecutor:attribute-data", ["attributedatapexecutor", "attribute p", "attribute_search_order", "en_p_attr_value_owner"]],
  ["pvaluecontroller:attribute", ["pvaluecontroller", "attribute pvaluecontroller"]],
  ["biztype:inventory", ["inventory", "재고"]],
  ["bizzid:quotation", ["quotation", "견적"]],
  ["bizzid:sales", ["sales", "판매"]],
  ["bizzid:shipping-order", ["shipping_order", "출하지시"]],
  ["menutype:input", ["input", "입력"]],
  ["menutype:list", ["list", "조회"]],
  ["menutype:status", ["status", "현황"]],
  ["menutype:exported", ["exported", "내보내기"]],
  ["slip:quotation", ["전표", "slip", "견적 전표", "quotation slip"]],
  ["slip-relation:to_slip_relation", ["to_slip_relation", "from_data", "불러온전표", "불러온 전표", "loaded slip", "isearchloadedslipuseraction", "view_loaded_slip"]],
  ["slip-relation:slip_relation", ["slip_relation", "to_data", "생성한전표", "생성한 전표", "generated slip", "isearchgeneratedslipuseraction", "view_relatedslip_created"]],
  ["transaction-type:relation", ["거래형", "transaction type", "relation"]],
  ["progress-status:progress_status", ["progress_status", "progress status", "진행상태"]],
  ["refer-alias:refer_alias", ["refer_alias", "refer alias", "출처 표시"]],
  ["dbtable:bd_data_conn_i", ["bd_data_conn_i", "connection bridge table", "연결관계 테이블"]],
  ["pattr-value-owner:bizz", ["en_p_attr_value_owner.bizz", "업무설정", "bizz setup"]],
  ["pattr-value-owner:bizz_item", ["en_p_attr_value_owner.bizz_item", "항목설정", "item setup", "bizz item"]],
  ["pattr-value-owner:template_item", ["en_p_attr_value_owner.template_item", "양식설정", "template setup", "template item"]]
];

const CODE_DOMAIN_RULES = [
  { terms: ["InventoryListComposableModel"], domain: ["composable-model:InventoryListComposableModel", "model-definition:quotationXlist", "relation:quotation-list", "prop:target", "prop:relation", "material:master"], relation: "defined_in" },
  { terms: ["$ModelDefinition", "ModelDefinition"], domain: ["model-definition:quotationXlist"], relation: "implemented_by" },
  { terms: ["compose_models", "$ModelDefiner.compose"], domain: ["composable-model:compose_models", "model-definition:quotationXlist"], relation: "implemented_by" },
  { terms: ["type.Relation", "IRelationInfo", "relations"], domain: ["model-relation:relations", "model-relation:relation-prop", "prop:relation"], relation: "implemented_by" },
  { terms: ["Repository", "repository", "repo_alias"], domain: ["repository:main", "repository:repo_alias"], relation: "implemented_by" },
  { terms: ["viewerWithJson", "json repo", "json repository"], domain: ["repository:json-repo"], relation: "implemented_by" },
  { terms: ["InventoryReadRequestMapperFactory"], domain: ["mapper:read-request", "mapper:quotation"], relation: "implemented_by" },
  { terms: ["SelectInventorySearchListAction", "ISelectInventorySearchListAction"], domain: ["program:upstream-action"], relation: "implemented_by" },
  { terms: ["CtxDefinitionResolver", "ctx_definition_resolver"], domain: ["resolver:CtxDefinitionResolver"], relation: "implemented_by" },
  { terms: ["SearchProgram2"], domain: ["program:SearchProgram2"], relation: "implemented_by" },
  { terms: ["GetCustomizedSearchModelDefinition", "CustomizedSearchModelProgram", "CustomizedSearchChildModelProgram", "GetSearchTemplateModelDefinition", "CreateSearchMaterial", "DefineSearchRelations", "DefineAbstractSearchPropsFromDbData"], domain: ["search-model-definition:quotationXlist_search", "attr:search", "mapper:read-request"], relation: "implemented_by" },
  { terms: ["ModelRelationInfoResolver", "model_relation_info_resolver", "load_relation_info_from_asset", "loadRelationInfoFromAsset"], domain: ["relation:quotation-list", "pipeline:customized-model"], relation: "resolved_by" },
  { terms: ["conn_data_custom_display_name", "conn_data"], domain: ["prop:conn_data"], relation: "declared_in" },
  { terms: ["get_dynamic_render_items_target_props", "target_props"], domain: ["prop:target", "attr:search"], relation: "declared_in" }
  ,
  { terms: ["MainItemMeaningPExecutor", "MainItemMeaningPExecutorBase", "p_item_meaning"], domain: ["pexecutor:main-item-meaning"], relation: "implemented_by" },
  { terms: ["AttributeDataPExecutor", "AttributeDataPExecutorBase"], domain: ["pexecutor:attribute-data", "attr:prop"], relation: "implemented_by" },
  { terms: ["PValueController", "AttributePValueController"], domain: ["pvaluecontroller:attribute", "attr:prop"], relation: "implemented_by" }
];

function node(id, label, type, description, layer = layerForType(type)) {
  return { id, label, type, layer, description, seed: true };
}

function layerForType(type) {
  if (type === "Evidence" || type.endsWith("Evidence")) return "evidence";
  if (type.startsWith("Code")) return "code";
  if (type === "DbTable") return "code";
  if (DOMAIN_NODE_TYPES.has(type)) return "domain";
  if (SEMANTIC_NODE_TYPES.has(type)) return "semantic";
  return "semantic";
}

function edge(source, target, type, confidence, evidence) {
  return { source, target, type, confidence, evidence };
}

function ensureDir(path) {
  mkdirSync(path, { recursive: true });
}

function ensureLayout() {
  for (const value of Object.values(SOURCE_PATHS)) {
    for (const path of Object.values(value)) ensureDir(path);
  }
  ensureDir(GRAPH_DIR);
  ensureDir(dirname(SCHEMA_PATH));
  ensureDir(dirname(STATUS_PATH));
}

function nowStamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function hash(value) {
  return createHash("sha1").update(value).digest("hex").slice(0, 12);
}

function slug(value) {
  return value
    .replace(/\\/g, "/")
    .replace(/[^A-Za-z0-9가-힣._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120) || "item";
}

function readJsonIfExists(path, fallback) {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, "utf-8").replace(/^\uFEFF/, ""));
}

function writeJson(path, value) {
  ensureDir(dirname(path));
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

function resolveRootPath(configuredPath, fallbackPath) {
  if (!configuredPath) return fallbackPath;
  return isAbsolute(configuredPath) ? configuredPath : join(ROOT, configuredPath);
}

function readSchema() {
  return readJsonIfExists(SCHEMA_PATH, {});
}

function getHtmlGeneration(schema = readSchema()) {
  return schema.html_generation ?? {};
}

function getGraphOutputPaths(schema = readSchema()) {
  const htmlGeneration = getHtmlGeneration(schema);
  return {
    graph: resolveRootPath(htmlGeneration.source_graph, join(GRAPH_DIR, "graph.json")),
    report: resolveRootPath(htmlGeneration.output_report, join(GRAPH_DIR, "report.md")),
    html: resolveRootPath(htmlGeneration.output_html, join(GRAPH_DIR, "graph.html"))
  };
}

function markStale(reason, details = {}) {
  const previous = readJsonIfExists(STATUS_PATH, {});
  writeJson(STATUS_PATH, {
    ...previous,
    stale: true,
    stale_reason: reason,
    stale_at: new Date().toISOString(),
    last_ingest: details
  });
}

function markIndexed(details) {
  const previous = readJsonIfExists(STATUS_PATH, {});
  writeJson(STATUS_PATH, {
    ...previous,
    stale: false,
    stale_reason: null,
    indexed_at: new Date().toISOString(),
    last_index: details
  });
}

function copyRecursive(source, destination) {
  const stats = statSync(source);
  if (stats.isDirectory()) {
    ensureDir(destination);
    for (const entry of readdirSync(source, { withFileTypes: true })) {
      copyRecursive(join(source, entry.name), join(destination, entry.name));
    }
    return;
  }
  ensureDir(dirname(destination));
  copyFileSync(source, destination);
}

function listFiles(root, predicate = () => true) {
  if (!existsSync(root)) return [];
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      if (entry.isFile() && predicate(path)) out.push(path);
    }
  };
  walk(root);
  return out.sort((a, b) => a.localeCompare(b));
}

function frontmatter(fields) {
  const lines = ["---"];
  for (const [key, value] of Object.entries(fields)) {
    if (Array.isArray(value)) {
      lines.push(`${key}:`);
      for (const item of value) lines.push(`  - ${JSON.stringify(item)}`);
    } else {
      lines.push(`${key}: ${JSON.stringify(value)}`);
    }
  }
  lines.push("---");
  return lines.join("\n");
}

function extractTextPart(part) {
  if (!part || typeof part !== "object") return "";
  if (typeof part.text === "string") return part.text;
  if (typeof part.content === "string") return part.content;
  return "";
}

function parseSessionJsonl(path) {
  const content = readFileSync(path, "utf-8");
  const records = [];
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      records.push(JSON.parse(trimmed));
    } catch {
      records.push({ type: "parse_error", raw: trimmed.slice(0, 300) });
    }
  }
  const session = records.find((record) => record.type === "session") ?? {};
  const model = records.find((record) => record.type === "model_change") ?? {};
  const messages = records
    .filter((record) => record.type === "message" && record.message)
    .map((record) => {
      const role = record.message.role ?? "unknown";
      const parts = Array.isArray(record.message.content) ? record.message.content : [];
      const text = parts.map(extractTextPart).filter(Boolean).join("\n\n");
      return { role, timestamp: record.timestamp ?? record.message.timestamp, text };
    })
    .filter((message) => message.text.trim().length > 0);
  const toolResults = records.filter((record) => record.type === "message" && record.message?.role === "toolResult").length;
  return {
    session_id: session.id ?? basename(path, extname(path)),
    cwd: session.cwd ?? "",
    timestamp: session.timestamp ?? "",
    provider: model.provider ?? "",
    model: model.modelId ?? "",
    records: records.length,
    messages,
    toolResults
  };
}

function summarizeMessages(messages, max = 12) {
  return messages.slice(0, max).map((message, index) => {
    const text = message.text.replace(/\s+/g, " ").trim().slice(0, 700);
    return `- turn ${index + 1} | ${message.role} | ${message.timestamp ?? ""}: ${text}`;
  }).join("\n") || "- no readable text messages found";
}

function normalizeConversation(provider, rawPath, copiedPath) {
  const parsed = extname(copiedPath).toLowerCase() === ".jsonl" ? parseSessionJsonl(copiedPath) : {
    session_id: basename(copiedPath, extname(copiedPath)),
    cwd: "",
    timestamp: "",
    provider,
    model: "",
    records: 0,
    messages: [{ role: "source", timestamp: "", text: readFileSync(copiedPath, "utf-8").slice(0, 8000) }],
    toolResults: 0
  };
  const normalizedPath = join(SOURCE_PATHS[provider].normalized, `${nowStamp()}-${slug(parsed.session_id)}.md`);
  const text = [
    frontmatter({
      title: `${provider} conversation ${parsed.session_id}`,
      source_type: "session",
      source_provider: provider,
      raw_path: relative(ROOT, copiedPath).replace(/\\/g, "/"),
      session_id: parsed.session_id,
      cwd: parsed.cwd,
      status: "needs_llm_review",
      confidence: "medium",
      created_at: new Date().toISOString()
    }),
    "",
    "# Normalized Evidence",
    "",
    "## Symptom",
    "- Extracted from conversation text. Needs LLM review for final symptom/cause separation.",
    "",
    "## Confirmed Cause",
    "- Not confirmed by deterministic ingest.",
    "",
    "## Affected Ontology Nodes",
    "- To be linked by /ontology-index keyword matching and later LLM review.",
    "",
    "## Conversation Facts",
    `- provider: ${provider}`,
    `- model: ${parsed.model || "unknown"}`,
    `- records: ${parsed.records}`,
    `- readable_messages: ${parsed.messages.length}`,
    `- tool_results: ${parsed.toolResults}`,
    "",
    "## Conversation Excerpts",
    summarizeMessages(parsed.messages),
    "",
    "## Code Evidence",
    "- To be filled by later analysis.",
    "",
    "## Board Context Evidence",
    "- To be linked when matching board evidence exists.",
    "",
    "## Debug Runtime Evidence",
    "- To be filled when runtime/debug notes exist.",
    "",
    "## Changed Files",
    "- To be filled by later analysis.",
    "",
    "## Unresolved Gaps",
    "- Deterministic ingest does not decide root cause.",
    "- LLM review should convert this into a canonical session document when the work item is important.",
    "",
    "## Reusable Rule",
    "- Not available yet."
  ].join("\n");
  writeFileSync(normalizedPath, text, "utf-8");
  return normalizedPath;
}

function ingestConversation(provider, inputPath) {
  if (!SOURCE_PATHS[provider]) throw new Error(`Unsupported conversation provider: ${provider}`);
  const source = resolve(inputPath);
  if (!existsSync(source)) throw new Error(`Input path does not exist: ${source}`);
  const destination = join(SOURCE_PATHS[provider].raw, basename(source));
  copyRecursive(source, destination);
  const normalizedPath = normalizeConversation(provider, source, destination);
  markStale(`ingested ${provider} conversation`, { source: provider, raw_path: destination, normalized_path: normalizedPath });
  return { raw_path: destination, normalized_path: normalizedPath };
}

function ingestDocs(input) {
  const stamp = nowStamp();
  if (/^https?:\/\//i.test(input)) {
    const rawPath = join(SOURCE_PATHS.docs.raw, `${stamp}-${slug(input)}.url.txt`);
    writeFileSync(rawPath, `${input}\n`, "utf-8");
    const normalizedPath = join(SOURCE_PATHS.docs.normalized, `${stamp}-${slug(input)}.md`);
    writeFileSync(normalizedPath, [
      frontmatter({
        title: `External document ${input}`,
        source_type: "docs",
        source_url: input,
        raw_path: relative(ROOT, rawPath).replace(/\\/g, "/"),
        status: "raw_url_only",
        confidence: "low",
        created_at: new Date().toISOString()
      }),
      "",
      "# Normalized Evidence",
      "",
      "The URL was recorded, but the document body was not fetched by this offline deterministic ingest.",
      "",
      "## Unresolved Gaps",
      "- Fetch and normalize the document body before treating it as evidence."
    ].join("\n"), "utf-8");
    markStale("ingested docs url", { raw_path: rawPath, normalized_path: normalizedPath });
    return { raw_path: rawPath, normalized_path: normalizedPath };
  }

  const source = resolve(input);
  if (!existsSync(source)) throw new Error(`Input path does not exist: ${source}`);
  const rawDestination = join(SOURCE_PATHS.docs.raw, `${stamp}-${basename(source)}`);
  copyRecursive(source, rawDestination);
  const normalizedPath = join(SOURCE_PATHS.docs.normalized, `${stamp}-${slug(basename(source))}.md`);
  const excerpt = statSync(source).isFile() ? readFileSync(source, "utf-8").slice(0, 12000) : `Directory copied from ${source}`;
  writeFileSync(normalizedPath, [
    frontmatter({
      title: `docs ${basename(source)}`,
      source_type: "docs",
      raw_path: relative(ROOT, rawDestination).replace(/\\/g, "/"),
      status: "normalized_excerpt",
      confidence: "medium",
      created_at: new Date().toISOString()
    }),
    "",
    "# Normalized Evidence",
    "",
    "## Source Excerpt",
    "",
    "```text",
    excerpt,
    "```"
  ].join("\n"), "utf-8");
  markStale("ingested docs path", { raw_path: rawDestination, normalized_path: normalizedPath });
  return { raw_path: rawDestination, normalized_path: normalizedPath };
}

function ingestClipper(inputPath) {
  if (!inputPath) {
    const mdFiles = listFiles(SOURCE_PATHS.clipper.normalized, (path) => extname(path).toLowerCase() === ".md");
    const htmlFiles = listFiles(SOURCE_PATHS.clipper.raw, (path) => [".html", ".htm"].includes(extname(path).toLowerCase()));
    markStale("using project-local clipper files", { board_md_count: mdFiles.length, raw_html_count: htmlFiles.length });
    return { board_md_count: mdFiles.length, raw_html_count: htmlFiles.length, source: "project-local" };
  }
  const root = resolve(inputPath);
  const boardDir = existsSync(join(root, "board")) ? join(root, "board") : root;
  const rawBoardDir = existsSync(join(root, "raw", "board")) ? join(root, "raw", "board") : undefined;
  const mdFiles = listFiles(boardDir, (path) => extname(path).toLowerCase() === ".md");
  const htmlFiles = rawBoardDir ? listFiles(rawBoardDir, (path) => [".html", ".htm"].includes(extname(path).toLowerCase())) : [];
  for (const file of htmlFiles) {
    copyRecursive(file, join(SOURCE_PATHS.clipper.raw, basename(file)));
  }
  for (const file of mdFiles) {
    copyRecursive(file, join(SOURCE_PATHS.clipper.normalized, basename(file)));
  }
  markStale("ingested clipper board files", { board_md_count: mdFiles.length, raw_html_count: htmlFiles.length });
  return { board_md_count: mdFiles.length, raw_html_count: htmlFiles.length, source: root };
}

function ingestCodebase(manifestPath) {
  const stamp = nowStamp();
  const graphPath = join(PROJECT_ROOT, "graphify-out", "graph.json");
  const reportPath = join(PROJECT_ROOT, "graphify-out", "GRAPH_REPORT.md");
  const keyPatterns = [
    "quotationXlist",
    "quotationXlist_search",
    "static∬quotationXlist",
    "IMenuDefinition",
    "model_info_list",
    "CtxDefinitionResolver",
    "context.definition.get",
    "InventoryReadRequestMapperFactory",
    "SelectInventorySearchListAction",
    "SearchProgram2",
    "relation_info",
    "target_props",
    "conn_data"
  ];
  const manifest = {
    created_at: new Date().toISOString(),
    project_root: PROJECT_ROOT,
    source_type: "codebase",
    graphify_graph: existsSync(graphPath) ? graphPath : null,
    graphify_report: existsSync(reportPath) ? reportPath : null,
    graphify_graph_size: existsSync(graphPath) ? statSync(graphPath).size : 0,
    key_patterns: keyPatterns,
    ownership_rule: "server/query model code can be analyzed directly; browser/EFA/EFE4 or EMO-owned core changes are team request items."
  };
  const manifestOut = join(SOURCE_PATHS.codebase.manifests, `${stamp}-query-model-codebase-manifest.json`);
  writeJson(manifestOut, manifestPath ? { ...manifest, imported_manifest: resolve(manifestPath) } : manifest);
  const normalizedPath = join(SOURCE_PATHS.codebase.normalized, `${stamp}-query-model-codebase.md`);
  writeFileSync(normalizedPath, [
    frontmatter({
      title: "query-model codebase evidence manifest",
      source_type: "codebase",
      raw_path: relative(ROOT, manifestOut).replace(/\\/g, "/"),
      status: "manifest_only",
      confidence: "high",
      created_at: new Date().toISOString()
    }),
    "",
    "# Normalized Evidence",
    "",
    "## Codebase Scope",
    `- project_root: ${PROJECT_ROOT}`,
    `- graphify_graph: ${manifest.graphify_graph ?? "missing"}`,
    `- graphify_report: ${manifest.graphify_report ?? "missing"}`,
    "",
    "## Query Model Keywords",
    ...keyPatterns.map((item) => `- ${item}`),
    "",
    "## Ownership Rule",
    "- server/query model code can be analyzed and planned directly.",
    "- browser/EFA/EFE4 or EMO-owned core changes are reported as team request items.",
    "",
    "## Unresolved Gaps",
    "- This manifest does not copy full source files.",
    "- Use repo graphify or source inspection for exact implementation evidence."
  ].join("\n"), "utf-8");
  markStale("ingested codebase manifest", { manifest_path: manifestOut, normalized_path: normalizedPath });
  return { manifest_path: manifestOut, normalized_path: normalizedPath };
}

function collectEvidence() {
  const roots = [
    SOURCE_PATHS.pi.normalized,
    SOURCE_PATHS.codex.normalized,
    SOURCE_PATHS.claude.normalized,
    SOURCE_PATHS.cursor.normalized,
    SOURCE_PATHS.codebase.normalized,
    SOURCE_PATHS.clipper.normalized,
    SOURCE_PATHS.docs.normalized
  ];
  const files = roots.flatMap((root) => listFiles(root, (path) => extname(path).toLowerCase() === ".md"));
  return files.map((path) => {
    const rel = relative(ROOT, path).replace(/\\/g, "/");
    const content = readFileSync(path, "utf-8");
    return {
      id: `evidence:${hash(rel)}`,
      label: basename(path, ".md"),
      type: "Evidence",
      description: rel,
      source_file: rel,
      source_kind: evidenceKind(rel),
      confidence: evidenceConfidence(rel),
      content,
      seed: false
    };
  });
}

function evidenceKind(rel) {
  if (rel.includes("/conversations/")) return "session";
  if (rel.includes("/codebase/")) return "codebase";
  if (rel.includes("/clipper/")) return "board";
  if (rel.includes("/docs/")) return "docs";
  return "raw";
}

function evidenceConfidence(rel) {
  const kind = evidenceKind(rel);
  if (kind === "session" || kind === "codebase") return "high";
  if (kind === "board" || kind === "docs") return "medium";
  return "low";
}

function normalizeSourceFile(path) {
  if (!path) return "";
  const absolute = resolve(path);
  const rel = relative(PROJECT_ROOT, absolute);
  return rel && !rel.startsWith("..") && !isAbsolute(rel) ? rel.replace(/\\/g, "/") : String(path).replace(/\\/g, "/");
}

function classifyGraphifyCodeNode(graphNode) {
  const label = String(graphNode.label ?? "");
  const sourceFile = String(graphNode.source_file ?? "");
  if (label.endsWith(".ts") || label.endsWith(".tsx") || label.endsWith(".js") || label.endsWith(".mjs")) return "CodeFile";
  if (/^[A-Z_$][A-Za-z0-9_$]*$/.test(label) || /^I[A-Z][A-Za-z0-9_$]*$/.test(label)) return "CodeClass";
  if (label.includes("()")) return "CodeFunction";
  if (sourceFile) return "CodeCallsite";
  return "CodeFunction";
}

function codeNodeId(graphNode) {
  const type = classifyGraphifyCodeNode(graphNode).toLowerCase();
  const base = graphNode.id || `${graphNode.source_file}:${graphNode.source_location}:${graphNode.label}`;
  return `${type}:${hash(String(base))}`;
}

function ownerScope(sourceFile) {
  const normalized = normalizeSourceFile(sourceFile).toLowerCase();
  if (normalized.startsWith("@source/browser/") || normalized.includes("/@source/browser/")) return "browser-owned-team-request";
  if (normalized.startsWith("@source/server/") || normalized.includes("/@source/server/")) return "server-query-model-direct";
  if (normalized.startsWith("@source/@shared/") || normalized.includes("/@source/@shared/")) return "shared-check-owner-before-edit";
  return "unknown";
}

function readCodebaseSnapshot() {
  const graphPath = join(PROJECT_ROOT, "graphify-out", "graph.json");
  if (!existsSync(graphPath)) return { nodes: [], edges: [], graphPath: null };
  const graph = JSON.parse(readFileSync(graphPath, "utf-8"));
  const graphNodes = Array.isArray(graph.nodes) ? graph.nodes : [];
  const graphEdges = Array.isArray(graph.links) ? graph.links : Array.isArray(graph.edges) ? graph.edges : [];
  const selected = new Map();
  for (const graphNode of graphNodes) {
    const haystack = `${graphNode.label ?? ""} ${graphNode.source_file ?? ""} ${graphNode.id ?? ""}`.toLowerCase();
    if (CODE_DOMAIN_RULES.some((rule) => rule.terms.some((term) => haystack.includes(term.toLowerCase())))) {
      selected.set(graphNode.id, graphNode);
    }
  }
  const codeNodes = [...selected.values()].map((graphNode) => ({
    id: codeNodeId(graphNode),
    label: String(graphNode.label ?? graphNode.id),
    type: classifyGraphifyCodeNode(graphNode),
    layer: "code",
    description: normalizeSourceFile(graphNode.source_file),
    source_file: normalizeSourceFile(graphNode.source_file),
    source_location: graphNode.source_location ?? null,
    owner_scope: ownerScope(graphNode.source_file),
    graphify_id: graphNode.id,
    community: graphNode.community ?? null,
    seed: false
  }));
  const byGraphifyId = new Map(codeNodes.map((node) => [node.graphify_id, node]));
  const codeEdges = [];
  for (const graphEdge of graphEdges) {
    const source = byGraphifyId.get(graphEdge.source ?? graphEdge._src);
    const target = byGraphifyId.get(graphEdge.target ?? graphEdge._tgt);
    if (!source || !target) continue;
    const relation = ["contains", "calls", "imports"].includes(graphEdge.relation) ? graphEdge.relation : "calls";
    codeEdges.push(edge(source.id, target.id, relation, graphEdge.confidence ?? "EXTRACTED", normalizeSourceFile(graphEdge.source_file)));
  }
  const domainEdges = [];
  for (const codeNode of codeNodes) {
    const haystack = `${codeNode.label} ${codeNode.source_file} ${codeNode.graphify_id}`.toLowerCase();
    for (const rule of CODE_DOMAIN_RULES) {
      if (!rule.terms.some((term) => haystack.includes(term.toLowerCase()))) continue;
      for (const domainId of rule.domain) {
        domainEdges.push(edge(domainId, codeNode.id, rule.relation, "codebase", codeNode.source_file || codeNode.label));
      }
    }
  }
  return { nodes: codeNodes, edges: [...domainEdges, ...codeEdges], graphPath };
}

function parseCsvLine(line) {
  const result = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (char === "," && !quoted) {
      result.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  result.push(current);
  return result;
}

function readPItemMeaningGraph() {
  if (!existsSync(P_ITEM_MEANING_PATH)) return { nodes: [], edges: [] };
  const lines = readFileSync(P_ITEM_MEANING_PATH, "utf-8").replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return { nodes: [], edges: [] };
  const headers = parseCsvLine(lines[0]);
  const pCodes = headers.slice(1).filter((header) => /^P\d{5}$/.test(header));
  const itemToP = new Map();
  for (const line of lines.slice(1)) {
    const cells = parseCsvLine(line);
    const itemMeaning = cells[0]?.trim();
    if (!itemMeaning) continue;
    const enabled = [];
    for (let i = 1; i < headers.length; i++) {
      if (cells[i]?.trim().toUpperCase() === "Y" && /^P\d{5}$/.test(headers[i])) {
        enabled.push(headers[i]);
      }
    }
    if (enabled.length > 0) itemToP.set(itemMeaning, enabled);
  }
  const queryRelevantItems = new Set([
    "tenant_sid",
    "bizz",
    "bizz_sid",
    "data_sid",
    "data_dt",
    "data_no",
    "progress_status_nm",
    "progress_status",
    "conn_data",
    "conn_data_001",
    "conn_data_002",
    "conn_data_003",
    "conn_data_004",
    "conn_data_005",
    "slip_relation",
    "to_slip_relation",
    "trx_type_nm",
    "attach_count"
  ]);
  const selectedPCodes = new Set(["P10001", "P10002", "P10006", "P80000"]);
  for (const enabled of itemToP.values()) {
    for (const pCode of enabled) {
      if (selectedPCodes.has(pCode)) continue;
      if (["P00001", "P00002", "P00003", "P00004", "P00005", "P00006", "P00007"].includes(pCode)) selectedPCodes.add(pCode);
    }
  }
  const selectedItems = [...itemToP.keys()].filter((item) => {
    if (queryRelevantItems.has(item)) return true;
    if (item.includes("conn_data")) return true;
    const enabled = itemToP.get(item) ?? [];
    return enabled.some((pCode) => ["P10001", "P10002", "P10006", "P80000"].includes(pCode));
  }).slice(0, 180);
  const nodes = [];
  const edges = [];
  for (const pCode of [...selectedPCodes].sort()) {
    nodes.push({
      id: `pcode:${pCode}`,
      label: pCode,
      type: "PCode",
      layer: "semantic",
      description: "P-code column from p_item_meaning.csv",
      source_file: normalizeSourceFile(P_ITEM_MEANING_PATH),
      seed: false
    });
    edges.push(edge(`pcode:${pCode}`, "pexecutor:main-item-meaning", "resolved_by", "codebase", normalizeSourceFile(P_ITEM_MEANING_PATH)));
  }
  for (const item of selectedItems) {
    const itemId = `itemmeaning:${hash(item)}`;
    nodes.push({
      id: itemId,
      label: item,
      type: "ItemMeaning",
      layer: "semantic",
      description: "item_meaning_id row from p_item_meaning.csv",
      source_file: normalizeSourceFile(P_ITEM_MEANING_PATH),
      seed: false
    });
    const enabled = itemToP.get(item) ?? [];
    for (const pCode of enabled.filter((code) => selectedPCodes.has(code))) {
      edges.push(edge(`pcode:${pCode}`, itemId, "enables_item_meaning", "codebase", normalizeSourceFile(P_ITEM_MEANING_PATH)));
      edges.push(edge(itemId, `pcode:${pCode}`, "enabled_by", "codebase", normalizeSourceFile(P_ITEM_MEANING_PATH)));
    }
    if (item.includes("conn_data")) edges.push(edge("prop:conn_data", itemId, "has_item_meaning", "codebase", item));
    if (item.includes("progress_status")) edges.push(edge("prop:target", itemId, "has_item_meaning", "codebase", item));
    if (item.includes("slip_relation")) edges.push(edge("prop:relation", itemId, "has_item_meaning", "codebase", item));
    if (item.includes("trx_type")) edges.push(edge("prop:relation", itemId, "has_item_meaning", "codebase", item));
  }
  edges.push(edge("material:exported", "pcode:P10002", "filters_attribute", "seed", "quotation exported bizz availability"));
  edges.push(edge("material:exported", "pcode:P10006", "filters_attribute", "seed", "quotation exported template availability"));
  edges.push(edge("failure:missing-prop", "pcode:P10002", "causes", "seed", "missing bizz availability P-code can hide exported props"));
  edges.push(edge("failure:missing-prop", "pcode:P10006", "causes", "seed", "missing template availability P-code can hide exported props"));
  return { nodes, edges };
}

function readPValueOwners() {
  if (!existsSync(ENUMS_PATH)) return [];
  const text = readFileSync(ENUMS_PATH, "utf-8");
  const match = text.match(/export const enum EN_P_ATTR_VALUE_OWNER\s*{([\s\S]*?)\n}/);
  if (!match) return [];
  return [...match[1].matchAll(/^\s*([A-Za-z0-9_]+)\s*=\s*'([^']+)'/gm)].map(([, key, value]) => ({ key, value }));
}

function readAttributePGraph() {
  const owners = readPValueOwners();
  const nodes = [];
  const edges = [];
  for (const owner of owners) {
    const ownerId = `pvalueowner:${owner.value}`;
    const attrPId = `attributep:${owner.value}`;
    nodes.push({
      id: ownerId,
      label: owner.value,
      type: "PValueOwner",
      layer: "semantic",
      description: `EN_P_ATTR_VALUE_OWNER.${owner.key}`,
      source_file: normalizeSourceFile(ENUMS_PATH),
      seed: false
    });
    nodes.push({
      id: attrPId,
      label: `AttributeP:${owner.value}`,
      type: "AttributeP",
      layer: "semantic",
      description: "attribute P lookup owner/scope node",
      source_file: normalizeSourceFile(ENUMS_PATH),
      seed: false
    });
    edges.push(edge(attrPId, ownerId, "owned_by", "codebase", normalizeSourceFile(ENUMS_PATH)));
    edges.push(edge(attrPId, "pexecutor:attribute-data", "resolved_by", "codebase", normalizeSourceFile(ENUMS_PATH)));
    edges.push(edge("attr:prop", attrPId, "activates_attribute", "codebase", owner.value));
  }
  const inheritanceOrder = [
    "ecount",
    "tenant",
    "tenant_attr_common",
    "tenant_attr_inventory",
    "user",
    "bizz",
    "bizz_item",
    "menu",
    "template",
    "template_section",
    "template_item",
    "model_set",
    "model",
    "static",
    "static_section"
  ].filter((owner) => owners.some((item) => item.value === owner));
  for (let i = 1; i < inheritanceOrder.length; i++) {
    edges.push(edge(`attributep:${inheritanceOrder[i]}`, `attributep:${inheritanceOrder[i - 1]}`, "inherits_from", "codebase", "EN_P_ATTR_VALUE_OWNER lookup order comment"));
  }
  if (existsSync(ATTRIBUTE_P_CONTROLLER_DIR)) {
    for (const file of listFiles(ATTRIBUTE_P_CONTROLLER_DIR, (path) => basename(path).endsWith("PValueController.ts"))) {
      const label = basename(file, ".ts");
      const id = `pvaluecontroller:${hash(normalizeSourceFile(file))}`;
      nodes.push({
        id,
        label,
        type: "PValueController",
        layer: "semantic",
        description: "attribute P value controller implementation",
        source_file: normalizeSourceFile(file),
        seed: false
      });
      edges.push(edge(id, "pvaluecontroller:attribute", "controlled_by", "codebase", normalizeSourceFile(file)));
      const ownerGuess = label
        .replace(/AttributePValueController$/, "")
        .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
        .toLowerCase()
        .replace(/^e_count_base$/, "ecount");
      if (owners.some((owner) => owner.value === ownerGuess)) {
        edges.push(edge(`attributep:${ownerGuess}`, id, "controlled_by", "codebase", normalizeSourceFile(file)));
      }
    }
  }
  return { nodes, edges };
}

function extractEvidenceEdges(evidenceNodes) {
  const edges = [];
  for (const evidenceNode of evidenceNodes) {
    const haystack = `${evidenceNode.label}\n${evidenceNode.content}`.toLowerCase();
    const matched = new Set();
    for (const [targetId, terms] of MATCHERS) {
      if (terms.some((term) => haystack.includes(term.toLowerCase()))) {
        matched.add(targetId);
      }
    }
    for (const targetId of [...matched].sort()) {
      edges.push(edge(targetId, evidenceNode.id, "evidenced_by", evidenceNode.confidence, evidenceNode.source_file));
    }
    if (matched.size === 0) {
      edges.push(edge("pipeline:customized-model", evidenceNode.id, "unverified_by", "low", `no ontology keyword match in ${evidenceNode.source_file}`));
    }
  }
  return edges;
}

function buildGraph() {
  ensureLayout();
  const schema = readSchema();
  const htmlGeneration = getHtmlGeneration(schema);
  const outputPaths = getGraphOutputPaths(schema);
  const evidenceNodes = collectEvidence();
  const codebase = readCodebaseSnapshot();
  const itemMeaningP = readPItemMeaningGraph();
  const attributeP = readAttributePGraph();
  const nodes = [
    ...SEED_NODES,
    ...itemMeaningP.nodes,
    ...attributeP.nodes,
    ...codebase.nodes,
    ...evidenceNodes.map(({ content, ...rest }) => ({ ...rest, layer: "evidence" }))
  ];
  const edges = dedupeEdges([
    ...SEED_EDGES,
    ...itemMeaningP.edges,
    ...attributeP.edges,
    ...codebase.edges,
    ...extractEvidenceEdges(evidenceNodes)
  ]);
  const stats = {
    nodes: nodes.length,
    edges: edges.length,
    domain_nodes: nodes.filter((node) => node.layer === "domain").length,
    semantic_nodes: nodes.filter((node) => node.layer === "semantic").length,
    evidence_nodes: evidenceNodes.length,
    code_nodes: codebase.nodes.length,
    p_nodes: itemMeaningP.nodes.length + attributeP.nodes.length,
    seed_nodes: SEED_NODES.length
  };
  const graphBasis = {
    schema_version: schema.schema_version ?? "2026-05-28.query-model-ontology.v1",
    root: ROOT,
    project_root: PROJECT_ROOT,
    default_trace_path: schema.default_trace_path ?? [],
    html_generation: htmlGeneration,
    nodes,
    edges,
    stats
  };
  const buildId = createHash("sha256").update(JSON.stringify(graphBasis)).digest("hex").slice(0, 16);
  const graph = {
    ...graphBasis,
    build_id: buildId,
    generated_at: htmlGeneration.deterministic === true ? `deterministic:${buildId}` : new Date().toISOString()
  };
  writeJson(outputPaths.graph, graph);
  ensureDir(dirname(outputPaths.report));
  writeFileSync(outputPaths.report, renderReport(graph), "utf-8");
  if (htmlGeneration.enabled !== false) {
    ensureDir(dirname(outputPaths.html));
    writeFileSync(outputPaths.html, renderGraphHtml(graph), "utf-8");
  }
  markIndexed(graph.stats);
  return graph;
}

function dedupeEdges(edges) {
  const seen = new Set();
  return edges.filter((graphEdge) => {
    const key = `${graphEdge.source}\u0000${graphEdge.type}\u0000${graphEdge.target}\u0000${graphEdge.evidence ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function countBy(items, key) {
  const out = {};
  for (const item of items) out[item[key] ?? "unknown"] = (out[item[key] ?? "unknown"] ?? 0) + 1;
  return out;
}

function renderReport(graph) {
  const nodeTypes = countBy(graph.nodes, "type");
  const nodeLayers = countBy(graph.nodes, "layer");
  const edgeTypes = countBy(graph.edges, "type");
  const sourceKinds = countBy(graph.nodes.filter((node) => node.type === "Evidence"), "source_kind");
  const htmlGeneration = graph.html_generation ?? {};
  const defaultTracePath = Array.isArray(graph.default_trace_path) && graph.default_trace_path.length
    ? graph.default_trace_path.join(" -> ")
    : "BizzType -> BizzId -> MenuType -> ModelId -> ModelDefinition -> RelationInfo -> Material -> Prop -> Mapper -> Program -> Evidence";
  return [
    "# Query Model Ontology Report",
    "",
    `Generated at: ${graph.generated_at}`,
    `Project root: ${graph.project_root}`,
    "",
    "## Stats",
    `- nodes: ${graph.stats.nodes}`,
    `- edges: ${graph.stats.edges}`,
    `- domain_nodes: ${graph.stats.domain_nodes}`,
    `- semantic_nodes: ${graph.stats.semantic_nodes}`,
    `- evidence_nodes: ${graph.stats.evidence_nodes}`,
    `- code_nodes: ${graph.stats.code_nodes}`,
    `- p_nodes: ${graph.stats.p_nodes}`,
    `- seed_nodes: ${graph.stats.seed_nodes}`,
    "",
    "## Layers",
    ...Object.entries(nodeLayers).sort().map(([key, value]) => `- ${key}: ${value}`),
    "",
    "## Node Types",
    ...Object.entries(nodeTypes).sort().map(([key, value]) => `- ${key}: ${value}`),
    "",
    "## Edge Types",
    ...Object.entries(edgeTypes).sort().map(([key, value]) => `- ${key}: ${value}`),
    "",
    "## Evidence Sources",
    ...Object.entries(sourceKinds).sort().map(([key, value]) => `- ${key}: ${value}`),
    "",
    "## HTML Generation",
    `- enabled: ${htmlGeneration.enabled !== false}`,
    `- command: ${htmlGeneration.command ?? "node .pi\\ontology\\query-model\\tools\\ontology-cli.mjs index"}`,
    `- source_graph: ${htmlGeneration.source_graph ?? "graph/graph.json"}`,
    `- output_html: ${htmlGeneration.output_html ?? "graph/graph.html"}`,
    `- output_report: ${htmlGeneration.output_report ?? "graph/report.md"}`,
    `- renderer: ${htmlGeneration.renderer ?? "inline-svg"}`,
    `- deterministic: ${htmlGeneration.deterministic === true}`,
    "",
    "## Default Trace Path",
    defaultTracePath,
    "",
    "## Known Gaps",
    "- Deterministic v1 links evidence by ontology keywords.",
    "- LLM-reviewed canonical session documents are still needed for confirmed root causes.",
    "- Codebase ingest stores manifest/snapshot evidence, not full source copies."
  ].join("\n");
}

function htmlEscape(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderGraphHtml(graph) {
  const htmlGeneration = graph.html_generation ?? {};
  const layout = htmlGeneration.layout ?? {};
  const viewport = layout.viewport ?? {};
  const title = htmlGeneration.title ?? "Quotation Query Model Ontology Graph";
  const tracePath = Array.isArray(htmlGeneration.default_trace_path) && htmlGeneration.default_trace_path.length
    ? htmlGeneration.default_trace_path
    : Array.isArray(graph.default_trace_path)
      ? graph.default_trace_path
      : [];
  const defaultTrace = tracePath.length
    ? tracePath.join(" -> ")
    : "BizzType -> BizzId -> MenuType -> ModelId -> ModelDefinition -> RelationInfo -> Material -> Prop -> Mapper -> Program -> Evidence";
  const columnOverrides = JSON.stringify(layout.columns ?? {}).replace(/</g, "\\u003c");
  const nodeGapConfig = JSON.stringify(layout.node_gap ?? {}).replace(/</g, "\\u003c");
  const viewBoxWidth = Number.isFinite(Number(viewport.width)) ? Number(viewport.width) : 1600;
  const viewBoxHeight = Number.isFinite(Number(viewport.height)) ? Number(viewport.height) : 950;
  const buildLabel = graph.build_id ? `build ${graph.build_id}` : graph.generated_at.slice(0, 10);
  const safeJson = JSON.stringify(graph).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${htmlEscape(title)}</title>
  <style>
    :root { --bg:#f6f8fb; --panel:#fff; --ink:#17202a; --muted:#64748b; --line:#d7dee8; --accent:#0f766e; --blue:#2563eb; --red:#b91c1c; }
    * { box-sizing:border-box; }
    html, body { width:100%; height:100%; margin:0; }
    body { font-family:"Segoe UI","Malgun Gothic",Arial,sans-serif; background:var(--bg); color:var(--ink); overflow:hidden; }
    .app { width:100vw; height:100vh; display:grid; grid-template-columns:300px minmax(0,1fr) 380px; }
    aside, section { min-width:0; min-height:0; overflow:auto; }
    aside { border-right:1px solid var(--line); background:var(--panel); padding:18px; }
    section.detail { border-left:1px solid var(--line); background:var(--panel); padding:18px; }
    main { min-width:0; min-height:0; display:flex; flex-direction:column; }
    header { padding:16px 18px; border-bottom:1px solid var(--line); background:var(--panel); }
    h1 { margin:0 0 6px; font-size:20px; letter-spacing:0; }
    h2 { margin:0 0 12px; font-size:16px; letter-spacing:0; }
    .muted { color:var(--muted); font-size:13px; }
    .stat { display:flex; justify-content:space-between; gap:12px; padding:8px 0; border-bottom:1px solid var(--line); font-size:13px; }
    .legend { display:grid; gap:8px; margin-top:16px; }
    .legend span { display:flex; align-items:center; gap:8px; font-size:13px; }
    .filters { display:grid; gap:8px; margin-top:16px; }
    .filters label { display:flex; align-items:center; gap:8px; font-size:13px; }
    .filter-list { display:grid; gap:6px; max-height:220px; overflow:auto; padding-right:4px; }
    .toolbar { display:flex; flex-wrap:wrap; gap:8px; align-items:center; margin-top:10px; }
    button { border:1px solid var(--line); background:#fff; color:var(--ink); border-radius:6px; padding:6px 9px; font-size:12px; cursor:pointer; }
    button:hover { border-color:#94a3b8; background:#f8fafc; }
    .swatch { width:12px; height:12px; border-radius:50%; display:inline-block; }
    .canvas-wrap { flex:1 1 auto; min-width:0; min-height:0; overflow:hidden; }
    svg { width:100%; height:100%; min-width:0; min-height:0; display:block; background:#f8fafc; cursor:grab; touch-action:none; }
    svg.dragging { cursor:grabbing; }
    .edge { stroke:#94a3b8; stroke-width:1.4; opacity:.72; }
    .edge.hidden { display:none; }
    .edge.seed { stroke:#64748b; opacity:.45; }
    .edge.evidence { stroke:#0f766e; opacity:.6; }
    .edge.selected { stroke:#b91c1c; stroke-width:2.4; opacity:.95; }
    .node.hidden { display:none; }
    .node.selected circle { stroke:#b91c1c; stroke-width:3; }
    .node circle { stroke:#fff; stroke-width:2; cursor:pointer; }
    .node text { font-size:11px; pointer-events:none; fill:#17202a; }
    .node .type { font-size:9px; fill:#64748b; }
    .pill { display:inline-block; margin:4px 4px 0 0; padding:3px 7px; border:1px solid var(--line); border-radius:6px; background:#f8fafc; font-size:12px; }
    pre { white-space:pre-wrap; word-break:break-word; padding:12px; border:1px solid var(--line); border-radius:8px; background:#0f172a; color:#dbeafe; font-size:12px; }
    @media (max-width:1100px) { .app { grid-template-columns:1fr; grid-template-rows:auto 1fr 280px; } aside { display:none; } section.detail { border-left:0; border-top:1px solid var(--line); } }
  </style>
</head>
<body>
  <div class="app">
    <aside>
      <h2>Graph Stats</h2>
      <div class="stat"><span>nodes</span><strong>${graph.stats.nodes}</strong></div>
      <div class="stat"><span>edges</span><strong>${graph.stats.edges}</strong></div>
      <div class="stat"><span>domain</span><strong>${graph.stats.domain_nodes}</strong></div>
      <div class="stat"><span>semantic</span><strong>${graph.stats.semantic_nodes}</strong></div>
      <div class="stat"><span>evidence</span><strong>${graph.stats.evidence_nodes}</strong></div>
      <div class="stat"><span>code</span><strong>${graph.stats.code_nodes}</strong></div>
      <div class="stat"><span>P</span><strong>${graph.stats.p_nodes}</strong></div>
      <div class="stat"><span>build</span><strong>${htmlEscape(buildLabel)}</strong></div>
      <div class="filters">
        <h2>Layers</h2>
        <label><input type="checkbox" data-layer="domain" checked> domain</label>
        <label><input type="checkbox" data-layer="semantic" checked> semantic</label>
        <label><input type="checkbox" data-layer="code" checked> code</label>
        <label><input type="checkbox" data-layer="evidence" checked> evidence</label>
      </div>
      <div class="filters">
        <h2>Edges</h2>
        <label><input type="radio" name="edge-mode" value="selected" checked> selected node only</label>
        <label><input type="radio" name="edge-mode" value="all"> visible checked edges</label>
        <label><input type="radio" name="edge-mode" value="none"> hide all edges</label>
        <div class="toolbar">
          <button type="button" id="edge-all">all</button>
          <button type="button" id="edge-none">none</button>
        </div>
        <div id="edge-type-filters" class="filter-list"></div>
      </div>
      <div class="legend">
        <h2>Types</h2>
        <span><i class="swatch" style="background:#15803d"></i> ERP Domain</span>
        <span><i class="swatch" style="background:#2563eb"></i> Model / Program</span>
        <span><i class="swatch" style="background:#0f766e"></i> Pipeline / Relation / Prop</span>
        <span><i class="swatch" style="background:#b45309"></i> FailureMode</span>
        <span><i class="swatch" style="background:#64748b"></i> Evidence</span>
        <span><i class="swatch" style="background:#7c3aed"></i> Code</span>
        <span><i class="swatch" style="background:#0891b2"></i> P / Attribute P</span>
      </div>
    </aside>
    <main>
      <header>
        <h1>${htmlEscape(title)}</h1>
        <div class="muted">Default trace: ${htmlEscape(defaultTrace)}</div>
        <div class="toolbar">
          <button type="button" id="zoom-in">Zoom in</button>
          <button type="button" id="zoom-out">Zoom out</button>
          <button type="button" id="zoom-reset">Reset</button>
          <span id="zoom-label" class="muted">100%</span>
        </div>
      </header>
      <div class="canvas-wrap"><svg id="graph" viewBox="0 0 ${viewBoxWidth} ${viewBoxHeight}" preserveAspectRatio="xMidYMid meet"></svg></div>
    </main>
    <section class="detail">
      <h2 id="detail-title">Select a node</h2>
      <div id="detail-body" class="muted">Click a node to inspect type, description, evidence, and neighbor edges.</div>
    </section>
  </div>
  <script>
    const graph = ${safeJson};
    const svg = document.getElementById("graph");
    const detailTitle = document.getElementById("detail-title");
    const detailBody = document.getElementById("detail-body");
    const edgeTypeFilters = document.getElementById("edge-type-filters");
    const zoomLabel = document.getElementById("zoom-label");
    const cols = {
      BizzType: 70,
      BizzId: 170,
      MenuType: 290,
      Slip: 390,
      SlipRelation: 510,
      TransactionType: 290,
      ProgressStatus: 410,
      ReferAlias: 410,
      PAttrValueOwner: 290,
      FailureSymptom: 170,
      MenuDefinition: 430,
      ModelDefinition: 500,
      ModelId: 560,
      SearchModelDefinition: 610,
      ComposableModel: 660,
      Repository: 760,
      ModelFactoryRegistration: 700,
      DefinitionResolver: 830,
      CustomizedModelPipeline: 960,
      RelationInfo: 1090,
      Relation: 1180,
      Material: 1210,
      Prop: 1330,
      Attribute: 1330,
      Mapper: 1460,
      Program: 1560,
      FailureMode: 430,
      Evidence: 1220,
      PCode: 1120,
      ItemMeaning: 1270,
      AttributeP: 1140,
      PValueOwner: 1280,
      PValueController: 1420,
      PExecutor: 1000,
      CodeFile: 840,
      CodeClass: 1080,
      CodeFunction: 1320,
      CodeCallsite: 1320,
      DbTable: 720
    };
    Object.assign(cols, ${columnOverrides});
    const nodeGapConfig = ${nodeGapConfig};
    const color = {
      BizzType:"#15803d", BizzId:"#16a34a", MenuType:"#65a30d", Slip:"#0d9488", SlipRelation:"#0891b2", TransactionType:"#4d7c0f", ProgressStatus:"#15803d", ReferAlias:"#0d9488", PAttrValueOwner:"#84cc16", FailureSymptom:"#b45309",
      ModelId:"#2563eb", ModelDefinition:"#1d4ed8", SearchModelDefinition:"#0ea5e9", ComposableModel:"#1d4ed8", MenuDefinition:"#2563eb", ModelFactoryRegistration:"#2563eb", DefinitionResolver:"#2563eb", Program:"#2563eb",
      CustomizedModelPipeline:"#0f766e", RelationInfo:"#0f766e", Relation:"#0f766e", Repository:"#0f766e", Material:"#0f766e", Prop:"#0f766e", Attribute:"#0f766e", Mapper:"#0f766e",
      Evidence:"#64748b", SessionEvidence:"#64748b", BoardEvidence:"#64748b", RuntimeEvidence:"#64748b", CodeEvidence:"#64748b",
      PCode:"#0891b2", ItemMeaning:"#06b6d4", AttributeP:"#0e7490", PValueOwner:"#155e75", PValueController:"#164e63", PExecutor:"#0f766e",
      CodeFile:"#7c3aed", CodeClass:"#7c3aed", CodeFunction:"#9333ea", CodeCallsite:"#a855f7", DbTable:"#6d28d9",
      FailureMode:"#d97706"
    };
    const byType = {};
    for (const n of graph.nodes) {
      if (!byType[n.type]) byType[n.type] = [];
      byType[n.type].push(n);
    }
    const positions = {};
    const typeOrder = Object.keys(byType).sort((a,b) => (cols[a] ?? 800) - (cols[b] ?? 800) || a.localeCompare(b));
    const columnBuckets = new Map();
    for (const type of typeOrder) {
      const x = cols[type] ?? 800;
      if (!columnBuckets.has(x)) columnBuckets.set(x, []);
      for (const node of byType[type].sort((a,b) => a.label.localeCompare(b.label))) {
        columnBuckets.get(x).push(node);
      }
    }
    for (const [x, items] of [...columnBuckets.entries()].sort((a,b) => a[0] - b[0])) {
      let y = items.some(node => node.type === "Evidence" || node.type.endsWith("Evidence")) ? 90 : 70;
      for (const node of items) {
        positions[node.id] = { x, y };
        y += nodeGap(node.type);
      }
    }
    const sortedColumns = [...new Set(Object.values(cols))].sort((a,b) => a - b);
    function labelLimit(type) {
      const x = cols[type] ?? 800;
      const next = sortedColumns.find(value => value > x) ?? ${viewBoxWidth};
      return Math.max(8, Math.min(28, Math.floor((next - x - 42) / 7)));
    }
    function compactLabel(value, type) {
      const text = String(value ?? "");
      const limit = labelLimit(type);
      return text.length > limit ? text.slice(0, Math.max(1, limit - 3)) + "..." : text;
    }
    function nodeGap(type) {
      if (type === "Evidence" || type.endsWith("Evidence")) return Number(nodeGapConfig.evidence ?? 42);
      if (type.startsWith("Code")) return Number(nodeGapConfig.code ?? 46);
      return Number(nodeGapConfig.default ?? 68);
    }
    function el(name, attrs = {}, text = "") {
      const node = document.createElementNS("http://www.w3.org/2000/svg", name);
      for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
      if (text) node.textContent = text;
      return node;
    }
    const defs = el("defs");
    defs.appendChild(el("marker", { id:"arrow", markerWidth:"8", markerHeight:"8", refX:"7", refY:"4", orient:"auto", markerUnits:"strokeWidth" }));
    defs.querySelector("marker").appendChild(el("path", { d:"M0,0 L8,4 L0,8 z", fill:"#94a3b8" }));
    svg.appendChild(defs);
    const viewportGroup = el("g", { id:"viewport" });
    const edgeGroup = el("g", { id:"edges" });
    const nodeGroup = el("g", { id:"nodes" });
    viewportGroup.appendChild(edgeGroup);
    viewportGroup.appendChild(nodeGroup);
    svg.appendChild(viewportGroup);
    const nodeElements = new Map();
    const edgeElements = [];
    let selectedNodeId = null;
    let zoomState = { scale: 1, x: 0, y: 0 };
    let dragState = null;
    const edgeTypes = [...new Set(graph.edges.map(e => e.type))].sort((a,b) => a.localeCompare(b));
    for (const type of edgeTypes) {
      const label = document.createElement("label");
      const input = document.createElement("input");
      input.type = "checkbox";
      input.dataset.edgeType = type;
      input.checked = type === "declares" || type === "resolves_to" || type === "builds" || type === "uses_relation_info" || type === "maps_request" || type === "executes";
      label.appendChild(input);
      label.appendChild(document.createTextNode(" " + type));
      edgeTypeFilters.appendChild(label);
    }
    for (const e of graph.edges) {
      const a = positions[e.source], b = positions[e.target];
      if (!a || !b) continue;
      const path = el("path", {
        class: "edge " + (e.type === "evidenced_by" || e.type === "cites_code" ? "evidence" : e.confidence === "seed" ? "seed" : ""),
        d: "M" + a.x + "," + a.y + " C" + (a.x + 80) + "," + a.y + " " + (b.x - 80) + "," + b.y + " " + b.x + "," + b.y,
        fill: "none",
        markerEnd: "url(#arrow)"
      });
      path.dataset.source = e.source;
      path.dataset.target = e.target;
      path.dataset.edgeType = e.type;
      path.appendChild(el("title", {}, e.source + " --" + e.type + "--> " + e.target + "\\n" + (e.evidence ?? "")));
      edgeGroup.appendChild(path);
      edgeElements.push({ element:path, edge:e });
    }
    for (const n of graph.nodes) {
      const p = positions[n.id];
      if (!p) continue;
      const g = el("g", { class:"node", transform:"translate(" + p.x + "," + p.y + ")" });
      g.dataset.layer = n.layer || "domain";
      g.dataset.nodeId = n.id;
      g.appendChild(el("circle", { r:(n.layer === "evidence" ? 8 : n.layer === "code" ? 10 : n.layer === "semantic" ? 12 : 14), fill:color[n.type] ?? "#64748b" }));
      g.appendChild(el("title", {}, n.label + "\\n" + n.type));
      g.appendChild(el("text", { x:18, y:-2 }, compactLabel(n.label, n.type)));
      g.appendChild(el("text", { class:"type", x:18, y:12 }, n.type));
      g.addEventListener("click", () => selectNode(n));
      nodeGroup.appendChild(g);
      nodeElements.set(n.id, g);
    }
    function selectNode(n) {
      selectedNodeId = n.id;
      const incident = graph.edges.filter(e => e.source === n.id || e.target === n.id);
      detailTitle.textContent = n.label;
      detailBody.innerHTML =
        '<span class="pill">' + n.type + '</span>' +
        (n.source_kind ? '<span class="pill">' + n.source_kind + '</span>' : '') +
        (n.confidence ? '<span class="pill">' + n.confidence + '</span>' : '') +
        '<p>' + escapeHtml(n.description ?? '') + '</p>' +
        '<h2>Edges</h2>' +
        '<pre>' + escapeHtml(incident.map(e => e.source + ' --' + e.type + ' [' + e.confidence + ']--> ' + e.target + (e.evidence ? '\\n  evidence: ' + e.evidence : '')).join('\\n\\n') || 'no incident edges') + '</pre>';
      updateVisibility();
    }
    function escapeHtml(value) {
      return String(value).replace(/[&<>"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch]));
    }
    function getEnabledLayers() {
      const enabled = new Set([...document.querySelectorAll("[data-layer]")].filter(input => input.checked).map(input => input.dataset.layer));
      return enabled;
    }
    function getEnabledEdgeTypes() {
      return new Set([...document.querySelectorAll("[data-edge-type]")].filter(input => input.checked).map(input => input.dataset.edgeType));
    }
    function getEdgeMode() {
      const checked = document.querySelector('input[name="edge-mode"]:checked');
      return checked ? checked.value : "selected";
    }
    function isNodeVisible(id) {
      const nodeElement = nodeElements.get(id);
      return Boolean(nodeElement && !nodeElement.classList.contains("hidden"));
    }
    function updateVisibility() {
      const enabledLayers = getEnabledLayers();
      for (const [id, nodeElement] of nodeElements) {
        const visible = enabledLayers.has(nodeElement.dataset.layer);
        nodeElement.classList.toggle("hidden", !visible);
        nodeElement.classList.toggle("selected", id === selectedNodeId);
      }
      const enabledEdgeTypes = getEnabledEdgeTypes();
      const mode = getEdgeMode();
      for (const { element, edge } of edgeElements) {
        const endpointVisible = isNodeVisible(edge.source) && isNodeVisible(edge.target);
        const typeVisible = enabledEdgeTypes.has(edge.type);
        const selectedVisible = selectedNodeId && (edge.source === selectedNodeId || edge.target === selectedNodeId);
        const visible = endpointVisible && typeVisible && mode !== "none" && (mode === "all" || selectedVisible);
        element.classList.toggle("hidden", !visible);
        element.classList.toggle("selected", Boolean(selectedVisible));
      }
    }
    function applyTransform() {
      viewportGroup.setAttribute("transform", "translate(" + zoomState.x + " " + zoomState.y + ") scale(" + zoomState.scale + ")");
      zoomLabel.textContent = Math.round(zoomState.scale * 100) + "%";
    }
    function zoomAt(clientX, clientY, factor) {
      const point = svg.createSVGPoint();
      point.x = clientX;
      point.y = clientY;
      const before = point.matrixTransform(viewportGroup.getScreenCTM().inverse());
      zoomState.scale = Math.max(0.25, Math.min(6, zoomState.scale * factor));
      applyTransform();
      const after = point.matrixTransform(viewportGroup.getScreenCTM().inverse());
      zoomState.x += (after.x - before.x) * zoomState.scale;
      zoomState.y += (after.y - before.y) * zoomState.scale;
      applyTransform();
    }
    svg.addEventListener("wheel", event => {
      event.preventDefault();
      zoomAt(event.clientX, event.clientY, event.deltaY < 0 ? 1.15 : 1 / 1.15);
    }, { passive:false });
    svg.addEventListener("pointerdown", event => {
      if (event.target.closest && event.target.closest(".node")) return;
      dragState = { pointerId:event.pointerId, x:event.clientX, y:event.clientY, tx:zoomState.x, ty:zoomState.y };
      svg.setPointerCapture(event.pointerId);
      svg.classList.add("dragging");
    });
    svg.addEventListener("pointermove", event => {
      if (!dragState) return;
      zoomState.x = dragState.tx + event.clientX - dragState.x;
      zoomState.y = dragState.ty + event.clientY - dragState.y;
      applyTransform();
    });
    svg.addEventListener("pointerup", event => {
      if (!dragState || dragState.pointerId !== event.pointerId) return;
      dragState = null;
      svg.classList.remove("dragging");
    });
    document.getElementById("zoom-in").addEventListener("click", () => zoomAt(svg.getBoundingClientRect().left + svg.clientWidth / 2, svg.getBoundingClientRect().top + svg.clientHeight / 2, 1.2));
    document.getElementById("zoom-out").addEventListener("click", () => zoomAt(svg.getBoundingClientRect().left + svg.clientWidth / 2, svg.getBoundingClientRect().top + svg.clientHeight / 2, 1 / 1.2));
    document.getElementById("zoom-reset").addEventListener("click", () => { zoomState = { scale:1, x:0, y:0 }; applyTransform(); });
    document.getElementById("edge-all").addEventListener("click", () => { document.querySelectorAll("[data-edge-type]").forEach(input => { input.checked = true; }); updateVisibility(); });
    document.getElementById("edge-none").addEventListener("click", () => { document.querySelectorAll("[data-edge-type]").forEach(input => { input.checked = false; }); updateVisibility(); });
    document.querySelectorAll("[data-layer], [data-edge-type], input[name='edge-mode']").forEach(input => input.addEventListener("change", updateVisibility));
    applyTransform();
    updateVisibility();
  </script>
</body>
</html>`;
}

function status() {
  ensureLayout();
  const state = readJsonIfExists(STATUS_PATH, { stale: true, stale_reason: "never indexed" });
  const outputPaths = getGraphOutputPaths();
  const normalizedCount = collectEvidence().length;
  return {
    root: ROOT,
    project_root: PROJECT_ROOT,
    normalized_evidence_count: normalizedCount,
    graph_exists: existsSync(outputPaths.graph),
    graph_path: outputPaths.graph,
    graph_html_path: outputPaths.html,
    graph_report_path: outputPaths.report,
    state
  };
}

function query(question) {
  const graphPath = getGraphOutputPaths().graph;
  if (!existsSync(graphPath)) throw new Error(`No graph found at ${graphPath}. Run ontology-cli index first.`);
  const graph = readJsonIfExists(graphPath, null);
  const questionLower = question.toLowerCase();
  const terms = question.toLowerCase().split(/[^a-z0-9가-힣_$∬]+/i).filter((term) => term.length >= 2);
  const score = (node) => {
    const haystack = `${node.label} ${node.type} ${node.description ?? ""}`.toLowerCase();
    const label = String(node.label ?? "").toLowerCase();
    const directLabelScore = label && questionLower.includes(label) ? 5 : 0;
    const termScore = terms.reduce((sum, term) => {
      if (haystack.includes(term)) return sum + 1;
      if (label && term.includes(label)) return sum + 1;
      return sum;
    }, 0);
    return directLabelScore + termScore;
  };
  const starts = graph.nodes.map((node) => [score(node), node]).filter(([s]) => s > 0).sort((a, b) => b[0] - a[0] || a[1].label.localeCompare(b[1].label)).slice(0, 8).map(([, node]) => node);
  const ids = new Set(starts.map((node) => node.id));
  const incident = [];
  const seenEdges = new Set();
  let frontier = new Set(ids);
  for (let depth = 0; depth < 6 && frontier.size > 0 && incident.length < 90; depth++) {
    const next = new Set();
    for (const graphEdge of graph.edges) {
      if (frontier.has(graphEdge.source) || frontier.has(graphEdge.target)) {
        const edgeKey = `${graphEdge.source}\u0000${graphEdge.type}\u0000${graphEdge.target}\u0000${graphEdge.evidence ?? ""}`;
        if (!seenEdges.has(edgeKey)) {
          seenEdges.add(edgeKey);
          incident.push(graphEdge);
        }
        if (!ids.has(graphEdge.source)) next.add(graphEdge.source);
        if (!ids.has(graphEdge.target)) next.add(graphEdge.target);
        ids.add(graphEdge.source);
        ids.add(graphEdge.target);
      }
    }
    frontier = next;
  }
  const nodes = graph.nodes.filter((node) => ids.has(node.id));
  return [
    "You are answering a quotation query-model ontology question.",
    "",
    `Question: ${question}`,
    "",
    "Rules:",
    "- Classify the request into domain, semantic, code, and evidence layers first.",
    "- Domain layer means ERP business flow only: BizzType, BizzId, MenuType, Slip, SlipRelation, TransactionType, ProgressStatus, ReferAlias, PAttrValueOwner, and user-visible FailureSymptom.",
    "- Semantic layer means 5.6 query-model mechanics: ModelDefinition, ModelId, SearchModelDefinition, ComposableModel, Repository, DefinitionResolver, RelationInfo, Relation, Material, Prop, Attribute, Mapper, Program, PCode, AttributeP, and FailureMode.",
    "- Trace backward through maps_search_condition, maps_request, activates, flattens, builds, and resolves_to.",
    "- Rank cause candidates as confirmed, strong, weak, or unverified.",
    "- Cite each claim as codebase, session, board, docs, or seed.",
    "- Traverse in this order when possible: ERP domain flow, semantic query-model path, code implementation nodes, then evidence provenance.",
    "- For prop/exported/attribute activation questions, include PCode, ItemMeaning, AttributeP, PValueOwner, PValueController, and PExecutor nodes when present.",
    "- Treat code nodes with owner_scope=browser-owned-team-request or shared-check-owner-before-edit as team request candidates, not silent local edits.",
    "- Expose unresolved gaps instead of guessing.",
    "",
    "Graph context:",
    "```json",
    JSON.stringify({ nodes, edges: incident }, null, 2),
    "```"
  ].join("\n");
}

function openGraph() {
  const outputPaths = getGraphOutputPaths();
  const html = outputPaths.html;
  if (!existsSync(html)) throw new Error(`No HTML artifact found. Expected ${html}. Run ontology-cli index first.`);
  execFileSync("cmd.exe", ["/c", "start", "", html], { windowsHide: true });
  return html;
}

function usage() {
  return `Usage:
  ontology-cli ingest pi <session-jsonl>
  ontology-cli ingest codex|claude|cursor <path>
  ontology-cli ingest clipper [board-dir]
  ontology-cli ingest docs <path-or-url>
  ontology-cli ingest codebase [manifest]
  ontology-cli index
  ontology-cli query <question>
  ontology-cli status
  ontology-cli open`;
}

function main(argv) {
  ensureLayout();
  const [command, ...rest] = argv;
  if (!command || command === "help" || command === "--help") {
    console.log(usage());
    return;
  }
  if (command === "ingest") {
    const [source, input] = rest;
    if (!source) throw new Error(usage());
    let result;
    if (["pi", "codex", "claude", "cursor"].includes(source)) {
      if (!input) throw new Error(`Missing input path for ${source}`);
      result = ingestConversation(source, input);
    } else if (source === "clipper") {
      result = ingestClipper(input);
    } else if (source === "docs") {
      if (!input) throw new Error("Missing path-or-url for docs");
      result = ingestDocs(input);
    } else if (source === "codebase") {
      result = ingestCodebase(input);
    } else {
      throw new Error(`Unsupported source: ${source}`);
    }
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (command === "index") {
    const graph = buildGraph();
    const outputPaths = getGraphOutputPaths();
    console.log(JSON.stringify({ graph_path: outputPaths.graph, report_path: outputPaths.report, html_path: outputPaths.html, stats: graph.stats }, null, 2));
    return;
  }
  if (command === "query") {
    const question = rest.join(" ").trim();
    if (!question) throw new Error("Missing question");
    console.log(query(question));
    return;
  }
  if (command === "status") {
    console.log(JSON.stringify(status(), null, 2));
    return;
  }
  if (command === "open") {
    console.log(JSON.stringify({ opened: openGraph() }, null, 2));
    return;
  }
  throw new Error(`Unknown command: ${command}\n${usage()}`);
}

try {
  main(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
