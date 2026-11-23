/** Inserta el token en las páginas que sirve el propio servidor para que el catálogo, quick-save y el bookmarklet lo envíen. */

export function injectAdminToken(html: string): string {
  const token = (process.env.ADMIN_TOKEN || '').trim();
  if (!token || html.includes('data-adt-admin="1"')) return html;
  const encoded = JSON.stringify(token).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
  const snippet = `<script data-adt-admin="1">(function(){var t=${encoded};if(!t)return;var orig=window.fetch;if(typeof orig!=="function")return;window.fetch=function(input,init){try{var url=typeof input==="string"?input:(input&&input.url)||"";var abs=url.charAt(0)==="/"?location.origin+url:url;if(abs.indexOf(location.origin+"/api/")===0){var opts=init?Object.assign({},init):{};var headers=new Headers(opts.headers||(typeof Request!=="undefined"&&input instanceof Request?input.headers:undefined));if(!headers.has("x-admin-token")&&!headers.has("Authorization"))headers.set("x-admin-token",t);opts.headers=headers;return orig.call(this,input,opts);}}catch(e){}return orig.call(this,input,init);};})();</script>`;
  const head = html.indexOf('</head>');
  if (head === -1) return `${snippet}${html}`;
  return `${html.slice(0, head)}${snippet}${html.slice(head)}`;
}
