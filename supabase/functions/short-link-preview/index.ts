import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function escapeHtml(text: string): string {
  const map: { [key: string]: string } = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };
  return text.replace(/[&<>"']/g, (m) => map[m]);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const url = new URL(req.url);
    const pathParts = url.pathname.split('/');
    const shortCode = pathParts[pathParts.length - 1];

    if (!shortCode) {
      return new Response("Short code not provided", {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "text/plain" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: linkData, error } = await supabase
      .from("short_links")
      .select("*")
      .eq("short_code", shortCode)
      .maybeSingle();

    if (error || !linkData) {
      return new Response("Link not found", {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "text/plain" },
      });
    }

    const userAgent = req.headers.get("user-agent") || "";
    const isBot = /bot|crawler|spider|crawling|facebookexternalhit|twitterbot/i.test(userAgent);

    if (isBot) {
      const title = escapeHtml(linkData.preview_title || 'Authorization Required');
      const description = escapeHtml(linkData.preview_description || 'Click to authorize');
      const image = linkData.preview_image || '';
      const domain = escapeHtml(linkData.preview_domain || '');

      const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  
  <!-- Open Graph / Facebook -->
  <meta property="og:type" content="website">
  <meta property="og:url" content="${url.toString()}">
  <meta property="og:title" content="${title}">
  <meta property="og:description" content="${description}">
  ${image ? `<meta property="og:image" content="${image}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">` : ''}
  ${domain ? `<meta property="og:site_name" content="${domain}">` : ''}
  
  <!-- Twitter Card -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${title}">
  <meta name="twitter:description" content="${description}">
  ${image ? `<meta name="twitter:image" content="${image}">` : ''}
  ${domain ? `<meta name="twitter:site" content="${domain}">` : ''}
  
  <meta http-equiv="refresh" content="0;url=${linkData.target_url}">
</head>
<body>
  <p>Redirecting...</p>
  <script>window.location.href = "${linkData.target_url}";</script>
</body>
</html>`;

      return new Response(html, {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "public, max-age=3600",
        },
      });
    }

    await supabase
      .from("short_links")
      .update({ click_count: linkData.click_count + 1 })
      .eq("id", linkData.id);

    return new Response(null, {
      status: 302,
      headers: {
        ...corsHeaders,
        "Location": linkData.target_url,
      },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});