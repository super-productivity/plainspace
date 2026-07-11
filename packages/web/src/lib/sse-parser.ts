// Incremental parser for the text/event-stream wire format.
// Spec: https://html.spec.whatwg.org/multipage/server-sent-events.html#parsing-an-event-stream
// Returns one event per blank line. Comment lines (":...") and unknown fields
// are ignored. Partial events without a trailing blank line are not emitted.

export type SSEParsedEvent = { event: string; data: string };

export function createSSEParser() {
  let buffer = '';
  let eventName = 'message';
  let dataLines: string[] = [];

  function consumeLine(line: string, out: SSEParsedEvent[]) {
    if (line === '') {
      if (dataLines.length > 0) {
        out.push({ event: eventName, data: dataLines.join('\n') });
      }
      eventName = 'message';
      dataLines = [];
      return;
    }
    if (line.startsWith(':')) return;

    const separator = line.indexOf(':');
    const field = separator === -1 ? line : line.slice(0, separator);
    let value = separator === -1 ? '' : line.slice(separator + 1);
    if (value.startsWith(' ')) value = value.slice(1);

    if (field === 'event') {
      eventName = value;
    } else if (field === 'data') {
      dataLines.push(value);
    }
  }

  return {
    feed(chunk: string): SSEParsedEvent[] {
      buffer += chunk;
      const lines = buffer.split(/\r\n|\r|\n/);
      buffer = lines.pop() ?? '';
      const out: SSEParsedEvent[] = [];
      for (const line of lines) consumeLine(line, out);
      return out;
    },
  };
}
