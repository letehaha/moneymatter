import type { ChatClarificationPart, ChatMessagePart, ChatPickableRecordKind } from '@bt/shared/types';
import ChatMessages from '@models/chat-messages.model';

export interface PickedRecord {
  kind: ChatPickableRecordKind;
  id: string;
  label: string;
}

/**
 * The records the user picked with their answers to earlier questions: each chosen option that stands for a
 * record. `clarifications` are the questions of the thread, `answers` the answers of one user message.
 */
export const pickedRecordsOf = ({
  answers,
  clarifications,
}: {
  answers: Array<{ clarificationId: string; optionIds: string[] }>;
  clarifications: ChatClarificationPart[];
}): PickedRecord[] =>
  answers.flatMap((answer) => {
    const question = clarifications.find((candidate) => candidate.id === answer.clarificationId);
    return answer.optionIds.flatMap((optionId) => {
      const option = question?.options.find((candidate) => candidate.id === optionId);
      return option?.record ? [{ ...option.record, label: option.label }] : [];
    });
  });

const clarificationAnswersIn = ({ parts }: { parts: ChatMessagePart[] }) =>
  parts.flatMap((part) =>
    part.type === 'clarificationAnswer' ? [{ clarificationId: part.clarificationId, optionIds: part.optionIds }] : [],
  );

/** The records the user picked in the message this run answers; none when it is not an answer to a question. */
export async function loadPickedRecords({
  threadId,
  userId,
  userMessageId,
}: {
  threadId: string;
  userId: number;
  userMessageId: string;
}): Promise<PickedRecord[]> {
  const message = await ChatMessages.findOne({
    where: { id: userMessageId, threadId, userId },
    attributes: ['parts'],
  });
  const answers = clarificationAnswersIn({ parts: message?.parts ?? [] });
  if (answers.length === 0) return [];

  const assistants = await ChatMessages.findAll({
    where: { threadId, userId, role: 'assistant' },
    attributes: ['parts'],
    order: [['createdAt', 'DESC']],
    limit: 20,
  });
  const clarifications = assistants.flatMap((row) =>
    row.parts.filter((part): part is ChatClarificationPart => part.type === 'clarification'),
  );

  return pickedRecordsOf({ answers, clarifications });
}
