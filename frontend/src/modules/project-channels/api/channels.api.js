import client from '@/shared/api/client';

export async function getChannels(projectId) {
  const res = await client.get(`/project-channels?projectId=${projectId}`);
  return res.data;
}

export async function createChannel(data) {
  const res = await client.post('/project-channels', data);
  return res.data;
}

export async function updateChannel(id, data) {
  const res = await client.patch(`/project-channels/${id}`, data);
  return res.data;
}

export async function deleteChannel(id) {
  await client.delete(`/project-channels/${id}`);
}
