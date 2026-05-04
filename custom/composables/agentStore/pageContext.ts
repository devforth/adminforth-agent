export function getCurrentPageContext() {
  return {
    path: window.location.pathname,
    fullPath: `${window.location.pathname}${window.location.search}${window.location.hash}`,
    title: document.title,
    url: window.location.href,
  };
}