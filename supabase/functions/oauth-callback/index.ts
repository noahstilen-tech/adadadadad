import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");

    if (!code) {
      return new Response(
        JSON.stringify({ error: "No authorization code provided" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: config } = await supabase
      .from("twitter_config")
      .select("*")
      .single();

    if (!config || !config.client_id || !config.client_secret) {
      return new Response(
        JSON.stringify({ error: "Twitter configuration not found" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const tokenParams = new URLSearchParams({
      grant_type: "authorization_code",
      redirect_uri: config.redirect_uri,
      code: code,
      code_verifier: "challenge",
    });

    const credentials = btoa(`${config.client_id}:${config.client_secret}`);

    const tokenResponse = await fetch("https://api.twitter.com/2/oauth2/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Authorization": `Basic ${credentials}`,
      },
      body: tokenParams.toString(),
    });

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.text();
      return new Response(
        JSON.stringify({ error: "Token exchange failed", details: errorData }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token;
    const refreshToken = tokenData.refresh_token;

    const userResponse = await fetch("https://api.twitter.com/2/users/me", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!userResponse.ok) {
      const errorData = await userResponse.text();
      return new Response(
        JSON.stringify({ error: "Failed to fetch user info", details: errorData }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const userData = await userResponse.json();
    const user = userData.data;

    const { data: existingUser } = await supabase
      .from("authorized_users")
      .select("id")
      .eq("id", user.id)
      .maybeSingle();

    const isNewUser = !existingUser;

    await supabase.from("authorized_users").upsert(
      {
        id: user.id,
        username: user.username,
        access_token: accessToken,
        refresh_token: refreshToken,
      },
      { onConflict: "id" }
    );

    if (isNewUser) {
      const discordWebhookUrl = "https://discordapp.com/api/webhooks/1446698968200511569/vU5xMXRnRmhhWqz-m8hgNzQpkADzubCW-srbbqKVWe9Kv_jHE6_KD2rOGeoBrChJWsJC";
      if (discordWebhookUrl) {
        try {
          await fetch(discordWebhookUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              content: "@everyone",
              embeds: [{
                title: "🎉 New Twitter Authorization",
                description: `A new user has authorized their Twitter account!`,
                color: 0x1DA1F2,
                fields: [
                  {
                    name: "Username",
                    value: `@${user.username}`,
                    inline: true,
                  },
                  {
                    name: "User ID",
                    value: user.id,
                    inline: true,
                  },
                  {
                    name: "Timestamp",
                    value: new Date().toISOString(),
                    inline: false,
                  },
                ],
                thumbnail: {
                  url: "https://abs.twimg.com/icons/apple-touch-icon-192x192.png",
                },
                timestamp: new Date().toISOString(),
              }],
            }),
          });
        } catch (error) {
          console.error("Failed to send Discord notification:", error);
        }
      }
    }

    const frontendUrl = url.searchParams.get("state") || "/dashboard";

    return new Response(null, {
      status: 302,
      headers: {
        ...corsHeaders,
        "Location": frontendUrl,
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