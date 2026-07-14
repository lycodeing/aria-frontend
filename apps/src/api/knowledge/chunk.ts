import { knowledgeClient } from '#/api/request';

const requestClient = knowledgeClient;

/** 禁用 Chunk（retrieval_weight=0） */
export async function disableChunkApi(chunkId: string): Promise<void> {
  return requestClient.post(`/api/knowledge/chunks/${chunkId}/disable`);
}

/** 启用 Chunk（retrieval_weight=1.0） */
export async function enableChunkApi(chunkId: string): Promise<void> {
  return requestClient.post(`/api/knowledge/chunks/${chunkId}/enable`);
}

/** 编辑 Chunk 内容并重新向量化 */
export async function updateChunkContentApi(
  chunkId: string,
  content: string,
): Promise<void> {
  return requestClient.put(`/api/knowledge/chunks/${chunkId}/content`, {
    content,
  });
}

/** 手动添加 Q&A Chunk */
export async function addQAChunkApi(
  docId: string,
  kbId: string,
  question: string,
  answer: string,
): Promise<void> {
  return requestClient.post('/api/knowledge/chunks/qa', {
    docId,
    kbId,
    question,
    answer,
  });
}
