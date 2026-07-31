// postal-mime accepts Node.js Buffer input, but this Worker passes ArrayBuffer only.
// Define the type alias without pulling Node runtime types into the Worker project.
type Buffer = Uint8Array<ArrayBufferLike>;
