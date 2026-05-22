import client from '@/shared/api/client';

export type FieldType = 'text' | 'number' | 'date' | 'select' | 'boolean' | 'textarea';

export type FieldEntity = 'lead' | 'client' | 'product';

export interface FieldOptions {
  choices?: string[];
}

export interface FieldDefinition {
  id: number;
  project_id: number;
  entity: FieldEntity;
  field_key: string;
  label: string;
  type: FieldType;
  required: boolean;
  orden: number;
  options?: FieldOptions | null;
  active?: boolean;
  created_at?: string;
  updated_at?: string;
}

export type FieldDefinitionInput = Omit<FieldDefinition, 'id' | 'created_at' | 'updated_at'>;

export async function listFields(projectId: number, entity?: FieldEntity): Promise<FieldDefinition[]> {
  const qs = entity ? `?entity=${entity}` : '';
  const res = await client.get(`/field-definitions/project/${projectId}${qs}`);
  return (res.data as FieldDefinition[]) || [];
}

export async function createField(payload: Partial<FieldDefinitionInput>): Promise<FieldDefinition> {
  const res = await client.post('/field-definitions', payload);
  return res.data as FieldDefinition;
}

export async function updateField(id: number, fields: Partial<FieldDefinition>): Promise<FieldDefinition> {
  const res = await client.patch(`/field-definitions/${id}`, fields);
  return res.data as FieldDefinition;
}

export async function deleteField(id: number): Promise<void> {
  await client.delete(`/field-definitions/${id}`);
}

export interface ReorderItem {
  id: number;
  orden: number;
}

export async function reorderFields(projectId: number, order: ReorderItem[]): Promise<void> {
  await client.post('/field-definitions/reorder', { project_id: projectId, order });
}
