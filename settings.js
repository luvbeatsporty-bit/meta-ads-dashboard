import { DEFAULT_RULES } from './data-model.js';
export function newWorkspace(name='未命名工作配置'){return {id:crypto.randomUUID(),name,company:'',adAccountId:'',rules:{...DEFAULT_RULES},createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};}
export function normalizeWorkspace(workspace){return {...newWorkspace(workspace?.name||'未命名工作配置'),...workspace,rules:{...DEFAULT_RULES,...(workspace?.rules||{})}};}
