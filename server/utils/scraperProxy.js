function getScraperProxy() {
  const value = process.env.SCRAPER_PROXY_URL?.trim();
  if (!value) return null;

  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('SCRAPER_PROXY_URL must be a valid HTTP or HTTPS proxy URL.');
  }

  if (
    !['http:', 'https:'].includes(url.protocol) ||
    !url.hostname ||
    !url.port ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error('SCRAPER_PROXY_URL must include an HTTP or HTTPS proxy host and port only.');
  }

  return {
    server: `${url.protocol}//${url.host}`,
    ...(url.username
      ? {
          username: decodeURIComponent(url.username),
          password: decodeURIComponent(url.password),
        }
      : {}),
  };
}

function getAxiosProxyOptions() {
  const proxy = getScraperProxy();
  if (!proxy) return {};

  const url = new URL(proxy.server);
  return {
    proxy: {
      protocol: url.protocol.slice(0, -1),
      host: url.hostname,
      port: Number(url.port),
      ...(proxy.username
        ? { auth: { username: proxy.username, password: proxy.password } }
        : {}),
    },
  };
}

module.exports = { getScraperProxy, getAxiosProxyOptions };
