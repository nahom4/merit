import { spawn } from 'node:child_process';
import { err, ok, type Result } from '@merit/shared';
import { DocumentUnavailable } from '@merit/application';
import type { AnnouncementDocumentGateway } from '@merit/application';

export interface GrantsGovAttachmentGatewayOptions {
  /**
   * The attachment host, which is **not** the API host.
   *
   * `api.grants.gov/v1/api` serves search and detail and answers 403 for attachments; the file
   * itself comes from `grants.gov/grantsws/rest/opportunity/att/download/{id}`. Verified against
   * the live service on 8 August 2026: attachment 354136 returns 200, `application/pdf`,
   * 303,791 bytes. See `tests/contract/grants-gov.contract.test.ts`.
   */
  readonly baseUrl: string;
  readonly timeoutMs: number;
  /** How long `pdftotext` gets. A 60-page NOFO takes well under a second; a minute means the
   *  file is not what it claimed to be. */
  readonly extractTimeoutMs?: number;
  /** Refuses a file larger than this rather than buffering an agency's 400MB video. */
  readonly maxBytes?: number;
}

const DEFAULT_EXTRACT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_BYTES = 60 * 1024 * 1024;

/**
 * The rubric's source: an announcement's PDF, downloaded and turned into layout-preserving text.
 *
 * `pdftotext -layout` rather than a JavaScript PDF library, and the choice is not about
 * convenience. A rubric is a table — criterion in one column, points in another — and a
 * reading-order extractor interleaves the two into `Purpose and need 10 Response 50` with no way
 * to tell which number belongs to which row. `-layout` keeps the columns apart, which is the
 * only reason the extraction is legible at all. The cost is a system dependency (poppler-utils);
 * see ADR 0014.
 *
 * The PDF is piped to the binary over stdin, so nothing is ever written to disk: no temp file to
 * name, to collide, to leak on a crash, or to leave an announcement sitting in `/tmp`.
 */
export class GrantsGovAttachmentGateway implements AnnouncementDocumentGateway {
  constructor(private readonly options: GrantsGovAttachmentGatewayOptions) {}

  async fetchText(attachmentId: string): Promise<Result<string, DocumentUnavailable>> {
    const downloaded = await this.download(attachmentId);
    if (!downloaded.ok) return downloaded;

    return this.extract(downloaded.value, attachmentId);
  }

  private async download(attachmentId: string): Promise<Result<Buffer, DocumentUnavailable>> {
    const url = `${this.options.baseUrl.replace(/\/$/, '')}/${encodeURIComponent(attachmentId)}`;
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), this.options.timeoutMs);

    try {
      const response = await fetch(url, { signal: abort.signal, redirect: 'follow' });

      if (!response.ok) {
        return err(
          new DocumentUnavailable(`the attachment service returned ${response.status}`, {
            source: 'grants_gov',
            attachmentId,
            status: response.status,
          }),
        );
      }

      const declared = Number(response.headers.get('content-length') ?? '0');
      const limit = this.options.maxBytes ?? DEFAULT_MAX_BYTES;
      if (declared > limit) {
        return err(
          new DocumentUnavailable(`the attachment is ${declared} bytes, over the ${limit} byte limit`, {
            source: 'grants_gov',
            attachmentId,
            bytes: declared,
          }),
        );
      }

      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.byteLength > limit) {
        // The header lied, or there was no header. Checked again on what actually arrived.
        return err(
          new DocumentUnavailable(
            `the attachment is ${bytes.byteLength} bytes, over the ${limit} byte limit`,
            {
              source: 'grants_gov',
              attachmentId,
              bytes: bytes.byteLength,
            },
          ),
        );
      }

      return ok(bytes);
    } catch (cause) {
      const aborted = cause instanceof Error && cause.name === 'AbortError';
      return err(
        new DocumentUnavailable(
          aborted ? 'the attachment did not download in time' : 'the attachment could not be downloaded',
          {
            source: 'grants_gov',
            attachmentId,
            cause: cause instanceof Error ? cause.message : String(cause),
          },
        ),
      );
    } finally {
      clearTimeout(timer);
    }
  }

  private extract(pdf: Buffer, attachmentId: string): Promise<Result<string, DocumentUnavailable>> {
    const timeout = this.options.extractTimeoutMs ?? DEFAULT_EXTRACT_TIMEOUT_MS;

    return new Promise((resolve) => {
      // `-` twice: read the PDF from stdin, write the text to stdout.
      const child = spawn('pdftotext', ['-layout', '-', '-'], { timeout });

      const out: Buffer[] = [];
      const errorOut: Buffer[] = [];
      let settled = false;

      const settle = (result: Result<string, DocumentUnavailable>): void => {
        if (settled) return;
        settled = true;
        resolve(result);
      };

      child.stdout.on('data', (chunk: Buffer) => out.push(chunk));
      child.stderr.on('data', (chunk: Buffer) => errorOut.push(chunk));

      child.on('error', (cause: NodeJS.ErrnoException) => {
        settle(
          err(
            new DocumentUnavailable(
              cause.code === 'ENOENT'
                ? 'pdftotext is not installed, so announcement documents cannot be read'
                : 'pdftotext could not be run',
              { attachmentId, cause: cause.message, code: cause.code ?? 'unknown' },
            ),
          ),
        );
      });

      child.on('close', (code, signal) => {
        if (code !== 0) {
          return settle(
            err(
              new DocumentUnavailable('pdftotext could not read the attachment', {
                attachmentId,
                exitCode: code,
                signal: signal ?? 'none',
                stderr: Buffer.concat(errorOut).toString('utf8').slice(0, 400),
              }),
            ),
          );
        }

        const text = Buffer.concat(out).toString('utf8');

        // A scanned announcement is a real and common case: the PDF is images, `pdftotext`
        // succeeds, and what comes back is page breaks and nothing else. Reporting that as a
        // successful read would send an empty document to the extractor and get a confident
        // rubric back about nothing at all.
        if (text.replace(/\s/gu, '').length === 0) {
          return settle(
            err(
              new DocumentUnavailable(
                'the attachment has no text layer — it is most likely a scanned document',
                { attachmentId, bytes: pdf.byteLength },
              ),
            ),
          );
        }

        settle(ok(text));
      });

      child.stdin.on('error', () => {
        // The child died before the write finished. `close` reports the real reason; swallowing
        // this only stops an EPIPE from becoming an unhandled error event.
      });
      child.stdin.end(pdf);
    });
  }
}
