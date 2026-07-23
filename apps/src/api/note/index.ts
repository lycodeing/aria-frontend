// src/api/note/index.ts
import { conversationClient } from '#/api/request';

export interface NoteVO {
  id: number | string;
  content: string;
  createdBy: string;
  createTime: string;
  updateTime?: string;
}

/** 获取会话备注列表 */
export async function listNotesApi(sessionId: string): Promise<NoteVO[]> {
  return conversationClient.get(`/sessions/${sessionId}/notes`);
}

/** 新建会话备注 */
export async function createNoteApi(
  sessionId: string,
  content: string,
): Promise<NoteVO> {
  return conversationClient.post(`/sessions/${sessionId}/notes`, { content });
}

/** 更新会话备注 */
export async function updateNoteApi(
  sessionId: string,
  noteId: number | string,
  content: string,
): Promise<NoteVO> {
  return conversationClient.put(`/sessions/${sessionId}/notes/${noteId}`, {
    content,
  });
}

/** 删除会话备注 */
export async function deleteNoteApi(
  sessionId: string,
  noteId: number | string,
): Promise<void> {
  return conversationClient.delete(`/sessions/${sessionId}/notes/${noteId}`);
}
