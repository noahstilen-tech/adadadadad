import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { Key, Link2, AlertCircle, Sparkles, Upload, X, Home } from 'lucide-react';

export default function LinkGenerator() {
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [redirectUri, setRedirectUri] = useState('');
  const [frontendRedirectUrl, setFrontendRedirectUrl] = useState('');
  const [message, setMessage] = useState('');
  const [authLink, setAuthLink] = useState('');
  const [configId, setConfigId] = useState('');
  const [shortLink, setShortLink] = useState('');
  const [previewTitle, setPreviewTitle] = useState('');
  const [previewDescription, setPreviewDescription] = useState('');
  const [previewImage, setPreviewImage] = useState('');
  const [previewDomain, setPreviewDomain] = useState('');
  const [generating, setGenerating] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState('');

  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    const { data, error } = await supabase
      .from('twitter_config')
      .select('*')
      .maybeSingle();

    if (data) {
      setClientId(data.client_id || '');
      setClientSecret(data.client_secret || '');
      setRedirectUri(data.redirect_uri || '');
      setFrontendRedirectUrl(data.frontend_redirect_url || '');
      setConfigId(data.id);
    }
  };

  const handleSetKeys = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage('');

    if (!clientId || !clientSecret || !redirectUri) {
      setMessage('All fields are required');
      return;
    }

    const updateData = {
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      frontend_redirect_url: frontendRedirectUrl,
      updated_at: new Date().toISOString(),
    };

    const { error } = configId
      ? await supabase
          .from('twitter_config')
          .update(updateData)
          .eq('id', configId)
      : await supabase.from('twitter_config').insert([updateData]);

    if (error) {
      setMessage('Error saving keys: ' + error.message);
    } else {
      setMessage('Keys saved successfully!');
      if (!configId) loadConfig();
    }
  };

  const generateAuthLink = () => {
    if (!clientId || !redirectUri) {
      setMessage('Please set Twitter keys first');
      return;
    }

    const defaultRedirect = `${window.location.origin}/dashboard`;
    const finalRedirectUrl = frontendRedirectUrl || defaultRedirect;

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: 'tweet.read tweet.write users.read offline.access',
      state: finalRedirectUrl,
      code_challenge: 'challenge',
      code_challenge_method: 'plain',
    });

    const link = `https://twitter.com/i/oauth2/authorize?${params.toString()}`;
    setAuthLink(link);
  };

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) {
        setMessage('Image must be less than 5MB');
        return;
      }

      setImageFile(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setImagePreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const removeImage = () => {
    setImageFile(null);
    setImagePreview('');
    setPreviewImage('');
  };

  const uploadImage = async () => {
    if (!imageFile) return '';

    setUploadingImage(true);
    try {
      const fileExt = imageFile.name.split('.').pop();
      const fileName = `${Math.random().toString(36).substring(2)}_${Date.now()}.${fileExt}`;
      const filePath = `${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('preview-images')
        .upload(filePath, imageFile, {
          cacheControl: '3600',
          upsert: false,
        });

      if (uploadError) throw uploadError;

      const { data } = supabase.storage
        .from('preview-images')
        .getPublicUrl(filePath);

      return data.publicUrl;
    } catch (error) {
      setMessage(`Image upload error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return '';
    } finally {
      setUploadingImage(false);
    }
  };

  const generateShortLink = async () => {
    if (!authLink) {
      setMessage('Please generate an authorization link first');
      return;
    }

    if (!previewTitle || !previewDescription) {
      setMessage('Preview title and description are required');
      return;
    }

    setGenerating(true);
    setMessage('');

    try {
      let uploadedImageUrl = previewImage;

      if (imageFile && !previewImage) {
        uploadedImageUrl = await uploadImage();
        if (!uploadedImageUrl) {
          setGenerating(false);
          return;
        }
      }
      const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-short-link`;
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          targetUrl: authLink,
          previewTitle,
          previewDescription,
          previewImage: uploadedImageUrl,
          previewDomain,
        }),
      });

      const result = await response.json();

      if (response.ok) {
        setShortLink(result.shortUrl);
        setMessage('Short link with preview card created successfully!');
      } else {
        setMessage(`Error: ${result.error || 'Failed to create short link'}`);
      }
    } catch (error) {
      setMessage(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setGenerating(false);
    }
  };

  const copyToClipboard = (text: string, type: string) => {
    navigator.clipboard.writeText(text);
    setMessage(`${type} copied to clipboard!`);
  };

  return (
    <div className="min-h-screen bg-black">
      <div className="container mx-auto px-4 py-12">
        <div className="max-w-3xl mx-auto">
          <div className="text-center mb-12">
            <a href="/" className="inline-block group">
              <h1 className="text-5xl font-bold text-white mb-4 tracking-tight group-hover:text-slate-300 transition">
                [HOME]
              </h1>
            </a>
          </div>

          <div className="mb-12">
            <h2 className="text-3xl font-bold text-white tracking-tight">
              Link Generator
            </h2>
          </div>

          <div className="bg-zinc-950/80 backdrop-blur-xl border border-zinc-800 rounded-2xl p-6 mb-8 shadow-2xl">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-blue-400 mt-0.5 flex-shrink-0" />
              <div className="text-sm text-slate-300">
                <p className="font-semibold mb-2 text-white">Instructions:</p>
                <ol className="list-decimal list-inside space-y-1">
                  <li>
                    In your Twitter Developer Portal, add this callback URL to your app's allowed redirect URIs:
                    <div className="mt-2 bg-black border border-zinc-800 rounded-lg px-3 py-2 font-mono text-blue-400 break-all">
                      https://sckwtscmbwwdljcvpiwu.supabase.co/functions/v1/oauth-callback
                    </div>
                  </li>
                  <li className="mt-2">Enter your Twitter Developer App credentials below</li>
                  <li>
                    For the Twitter Redirect URI field below, enter the exact same callback URL shown above
                  </li>
                  <li>Click "Set Keys" to save your configuration</li>
                  <li>
                    Click "Generate Authorization Link" to create a link for users
                  </li>
                  <li>
                    Share the authorization link with users who need to authorize
                    your app
                  </li>
                  <li>
                    After users authorize, they'll be redirected and saved to the
                    dashboard
                  </li>
                </ol>
              </div>
            </div>
          </div>

          <div className="bg-zinc-950/80 backdrop-blur-xl border border-zinc-800 rounded-2xl shadow-2xl p-8 mb-8">
            <div className="flex items-center gap-2 mb-6">
              <Key className="w-6 h-6 text-blue-400" />
              <h2 className="text-2xl font-semibold text-white tracking-tight">
                Twitter API Configuration
              </h2>
            </div>

            <form onSubmit={handleSetKeys} className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Twitter Client ID
                </label>
                <input
                  type="text"
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  className="w-full px-4 py-3 bg-black border border-zinc-800 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition text-white placeholder-zinc-600"
                  placeholder="Enter your Twitter Client ID"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Twitter Client Secret
                </label>
                <input
                  type="password"
                  value={clientSecret}
                  onChange={(e) => setClientSecret(e.target.value)}
                  className="w-full px-4 py-3 bg-black border border-zinc-800 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition text-white placeholder-zinc-600"
                  placeholder="Enter your Twitter Client Secret"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Twitter Redirect URI
                </label>
                <input
                  type="text"
                  value={redirectUri}
                  onChange={(e) => setRedirectUri(e.target.value)}
                  className="w-full px-4 py-3 bg-black border border-zinc-800 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition text-white placeholder-zinc-600"
                  placeholder="https://your-domain.com/api/auth/callback"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Frontend Redirect URL (Optional)
                </label>
                <input
                  type="text"
                  value={frontendRedirectUrl}
                  onChange={(e) => setFrontendRedirectUrl(e.target.value)}
                  className="w-full px-4 py-3 bg-black border border-zinc-800 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition text-white placeholder-zinc-600"
                  placeholder="https://yoursite.com/success (defaults to /dashboard)"
                />
                <p className="mt-2 text-sm text-slate-400">
                  Where users should be redirected after authorization. Leave empty to use /dashboard.
                </p>
              </div>

              <button
                type="submit"
                className="w-full bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 text-white font-semibold py-3 px-6 rounded-xl transition duration-200 shadow-lg shadow-blue-500/20"
              >
                Set Keys
              </button>
            </form>

            {message && (
              <div
                className={`mt-4 p-4 rounded-xl backdrop-blur-xl ${
                  message.includes('Error')
                    ? 'bg-red-500/10 text-red-400 border border-red-500/30'
                    : 'bg-green-500/10 text-green-400 border border-green-500/30'
                }`}
              >
                {message}
              </div>
            )}
          </div>

          <div className="bg-zinc-950/80 backdrop-blur-xl border border-zinc-800 rounded-2xl shadow-2xl p-8">
            <div className="flex items-center gap-2 mb-6">
              <Link2 className="w-6 h-6 text-blue-400" />
              <h2 className="text-2xl font-semibold text-white tracking-tight">
                Authorization Link
              </h2>
            </div>

            <button
              onClick={generateAuthLink}
              className="w-full bg-gradient-to-r from-slate-700 to-slate-600 hover:from-slate-600 hover:to-slate-500 text-white font-semibold py-3 px-6 rounded-xl transition duration-200 mb-4 shadow-lg shadow-slate-700/20"
            >
              Generate Authorization Link
            </button>

            {authLink && (
              <div className="space-y-4">
                <div className="bg-black border border-zinc-800 rounded-xl p-4">
                  <p className="text-sm text-slate-400 mb-2 font-medium">
                    Raw authorization link:
                  </p>
                  <p className="text-sm text-slate-200 break-all font-mono">
                    {authLink}
                  </p>
                </div>
                <button
                  onClick={() => copyToClipboard(authLink, 'Authorization link')}
                  className="w-full bg-slate-800 hover:bg-slate-700 text-white font-semibold py-2 px-4 rounded-xl transition duration-200"
                >
                  Copy Raw Link
                </button>
              </div>
            )}

            {authLink && (
              <div className="mt-8 pt-8 border-t border-zinc-800">
                <div className="flex items-center gap-2 mb-4">
                  <Sparkles className="w-5 h-5 text-amber-400" />
                  <h3 className="text-lg font-semibold text-white">
                    Create Link with Preview Card
                  </h3>
                </div>
                <p className="text-sm text-slate-400 mb-4">
                  Generate a branded short link that shows a custom preview card when shared in Twitter DMs.
                </p>

                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">
                      Preview Title *
                    </label>
                    <input
                      type="text"
                      value={previewTitle}
                      onChange={(e) => setPreviewTitle(e.target.value)}
                      className="w-full px-4 py-2 bg-black border border-zinc-800 rounded-xl focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none transition text-white placeholder-zinc-600"
                      placeholder="e.g., 30 Minute Meeting - ForbesCalendly"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">
                      Preview Description *
                    </label>
                    <textarea
                      value={previewDescription}
                      onChange={(e) => setPreviewDescription(e.target.value)}
                      className="w-full px-4 py-2 bg-slate-950/50 border border-slate-700 rounded-xl focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none transition resize-none text-white placeholder-slate-500"
                      placeholder="Brief description of what users will see after authorizing"
                      rows={2}
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">
                      Preview Image (Optional)
                    </label>

                    {!imagePreview && !previewImage && (
                      <div className="space-y-3">
                        <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-zinc-800 border-dashed rounded-xl cursor-pointer hover:border-amber-500 hover:bg-amber-500/5 transition">
                          <div className="flex flex-col items-center justify-center pt-5 pb-6">
                            <Upload className="w-8 h-8 text-zinc-600 mb-2" />
                            <p className="text-sm text-slate-400">
                              <span className="font-semibold">Click to upload</span> or drag and drop
                            </p>
                            <p className="text-xs text-zinc-500">PNG, JPG, GIF, WebP (max 5MB)</p>
                          </div>
                          <input
                            type="file"
                            className="hidden"
                            accept="image/png,image/jpeg,image/jpg,image/gif,image/webp"
                            onChange={handleImageChange}
                          />
                        </label>
                        <div className="text-center text-sm text-zinc-500">or</div>
                        <input
                          type="text"
                          value={previewImage}
                          onChange={(e) => setPreviewImage(e.target.value)}
                          className="w-full px-4 py-2 bg-black border border-zinc-800 rounded-xl focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none transition text-white placeholder-zinc-600"
                          placeholder="Enter image URL"
                        />
                      </div>
                    )}

                    {(imagePreview || previewImage) && (
                      <div className="relative">
                        <img
                          src={imagePreview || previewImage}
                          alt="Preview"
                          className="w-full h-48 object-cover rounded-xl border border-zinc-800"
                        />
                        <button
                          type="button"
                          onClick={removeImage}
                          className="absolute top-2 right-2 bg-red-500/90 backdrop-blur-sm hover:bg-red-600 text-white p-2 rounded-full shadow-lg transition"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">
                      Preview Domain (Optional)
                    </label>
                    <input
                      type="text"
                      value={previewDomain}
                      onChange={(e) => setPreviewDomain(e.target.value)}
                      className="w-full px-4 py-2 bg-black border border-zinc-800 rounded-xl focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none transition text-white placeholder-zinc-600"
                      placeholder="e.g., calendly.com"
                    />
                  </div>

                  <button
                    onClick={generateShortLink}
                    disabled={generating}
                    className="w-full bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 disabled:from-amber-400 disabled:to-amber-400 text-white font-semibold py-3 px-6 rounded-xl transition duration-200 shadow-lg shadow-amber-500/20"
                  >
                    {generating ? 'Generating...' : 'Generate Short Link with Preview'}
                  </button>

                  {shortLink && (
                    <div className="space-y-3">
                      <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 backdrop-blur-xl">
                        <p className="text-sm text-amber-300 mb-2 font-medium">
                          Share this link (with preview card):
                        </p>
                        <p className="text-sm text-amber-100 break-all font-mono">
                          {shortLink}
                        </p>
                      </div>
                      <button
                        onClick={() => copyToClipboard(shortLink, 'Short link')}
                        className="w-full bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 text-white font-semibold py-2 px-4 rounded-xl transition duration-200 shadow-lg shadow-amber-500/20"
                      >
                        Copy Short Link
                      </button>

                      <div className="bg-blue-500/10 border border-blue-500/30 rounded-xl p-4 mt-4 backdrop-blur-xl">
                        <p className="text-sm font-semibold text-blue-300 mb-2">
                          Testing Preview Card:
                        </p>
                        <ol className="text-xs text-slate-300 space-y-2 list-decimal list-inside">
                          <li>
                            Use Twitter Card Validator to check your preview:{' '}
                            <a
                              href={`https://cards-dev.twitter.com/validator`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="underline font-semibold hover:text-blue-400 text-blue-400"
                            >
                              cards-dev.twitter.com/validator
                            </a>
                          </li>
                          <li>Paste your short link and click "Preview card"</li>
                          <li>If it doesn't show correctly, Twitter may have cached an old version</li>
                          <li>
                            Note: Twitter's preview system can take a few minutes to update
                          </li>
                        </ol>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

          </div>
        </div>
      </div>
    </div>
  );
}
