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
    const { userId, text, tweets, mediaUrls } = await req.json();

    if (!userId || (!text && !tweets)) {
      return new Response(
        JSON.stringify({ error: "userId and either text or tweets array are required" }),
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

    const { data: user, error: userError } = await supabase
      .from("authorized_users")
      .select("*")
      .eq("id", userId)
      .single();

    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: "User not found" }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const tweetsToPost = tweets || [text];
    const postedTweets = [];
    let lastTweetId = null;
    let mediaIds: string[] = [];

    if (mediaUrls && mediaUrls.length > 0) {
      for (const mediaUrl of mediaUrls) {
        try {
          const mediaResponse = await fetch(mediaUrl);
          const mediaBlob = await mediaResponse.arrayBuffer();

          const uploadResponse = await fetch(
            "https://upload.twitter.com/1.1/media/upload.json",
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${user.access_token}`,
                "Content-Type": "application/octet-stream",
                "Content-Length": mediaBlob.byteLength.toString(),
              },
              body: mediaBlob,
            }
          );

          if (uploadResponse.ok) {
            const uploadData = await uploadResponse.json();
            mediaIds.push(uploadData.media_id_string);
          }
        } catch (error) {
          console.error("Failed to upload media:", error);
        }
      }
    }

    for (let i = 0; i < tweetsToPost.length; i++) {
      const tweetText = tweetsToPost[i];
      const tweetPayload: any = { text: tweetText };

      if (i === 0 && mediaIds.length > 0) {
        tweetPayload.media = {
          media_ids: mediaIds,
        };
      }

      if (lastTweetId) {
        tweetPayload.reply = {
          in_reply_to_tweet_id: lastTweetId,
        };
      }

      const tweetResponse = await fetch("https://api.twitter.com/2/tweets", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${user.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(tweetPayload),
      });

      if (!tweetResponse.ok) {
        const errorData = await tweetResponse.text();
        return new Response(
          JSON.stringify({
            error: "Failed to post tweet",
            details: errorData,
            posted: postedTweets
          }),
          {
            status: tweetResponse.status,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      const tweetData = await tweetResponse.json();
      postedTweets.push(tweetData.data);
      lastTweetId = tweetData.data.id;
    }

    return new Response(
      JSON.stringify({ success: true, data: postedTweets }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
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