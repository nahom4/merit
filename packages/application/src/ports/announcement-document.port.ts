import type { Result } from '@merit/shared';
import type { DocumentUnavailable } from '../errors.js';

/**
 * An announcement's own documents, as text.
 *
 * One call, because the two halves of the job — download the attachment, turn it into text —
 * have no independently useful middle. Nothing in Merit wants the bytes of a PDF; the rubric
 * extractor wants the words, and splitting the port would only push the temp-file dance up a
 * layer into a use case that has no business owning it.
 *
 * The text is the layout-preserving kind: a rubric is usually a table, and a table flattened
 * into reading order interleaves criterion names with point values until neither can be read.
 */
export interface AnnouncementDocumentGateway {
  fetchText(attachmentId: string): Promise<Result<string, DocumentUnavailable>>;
}
