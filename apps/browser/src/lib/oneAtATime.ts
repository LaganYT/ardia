export function oneAtATime() {
  let last: Promise<unknown> = Promise.resolve();
  return <T>(work: () => Promise<T>): Promise<T> => {
    const run = last.then(work);
    last = run.catch(() => {});
    return run;
  };
}
