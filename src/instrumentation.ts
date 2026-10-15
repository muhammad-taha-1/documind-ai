/**
 * Runs once when the server starts, before it handles any request.
 *
 * Documents are processed in the background inside the server process, so
 * any still marked in progress now were cut off by a restart or crash.
 * They're marked as failed, which shows the user a Retry button, instead of
 * spinning forever.
 */
export async function register() {
  // The recovery needs the database (Node.js only); the edge runtime has nothing to do
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }
  const { recoverInterruptedProcessing } = await import("@/lib/documents/processing");
  try {
    const recovered = await recoverInterruptedProcessing();
    if (recovered > 0) {
      console.warn(`Marked ${recovered} interrupted document(s) as failed so they can be retried`);
    }
  } catch (error) {
    // Not worth refusing to start over: the documents just stay as they are
    console.error("Could not recover interrupted document processing", error);
  }
}
