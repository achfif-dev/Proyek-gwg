export async function resolve(specifier, context, nextResolve) {
  try { return await nextResolve(specifier, context); }
  catch (e) {
    if ((specifier.startsWith("./") || specifier.startsWith("../")) && !/\.[a-z]+$/i.test(specifier)) {
      return nextResolve(specifier + ".js", context);
    }
    throw e;
  }
}
