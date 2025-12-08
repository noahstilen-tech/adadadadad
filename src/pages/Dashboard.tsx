import { useState, useEffect } from 'react';
import { supabase, AuthorizedUser } from '../lib/supabase';
import { config } from '../lib/config';
import { Users, Send, Trash2, Home, Plus, X, Image } from 'lucide-react';

export default function Dashboard() {
  const [users, setUsers] = useState<AuthorizedUser[]>([]);
  const [tweetTexts, setTweetTexts] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [messages, setMessages] = useState<Record<string, string>>({});
  const [deleteTweetId, setDeleteTweetId] = useState<Record<string, string>>({});
  const [deleting, setDeleting] = useState<Record<string, boolean>>({});
  const [mediaFiles, setMediaFiles] = useState<Record<string, File[]>>({});
  const [mediaUrls, setMediaUrls] = useState<Record<string, string[]>>({});
  const [uploading, setUploading] = useState<Record<string, boolean>>({});

  useEffect(() => {
    loadUsers();
  }, []);

  const loadUsers = async () => {
    const { data, error } = await supabase
      .from('authorized_users')
      .select('*')
      .order('created_at', { ascending: false });

    if (data) {
      setUsers(data);
    }
  };

  const addTweetToThread = (userId: string) => {
    const currentThread = tweetTexts[userId] || [''];
    setTweetTexts({ ...tweetTexts, [userId]: [...currentThread, ''] });
  };

  const removeTweetFromThread = (userId: string, index: number) => {
    const currentThread = tweetTexts[userId] || [''];
    if (currentThread.length > 1) {
      const newThread = currentThread.filter((_, i) => i !== index);
      setTweetTexts({ ...tweetTexts, [userId]: newThread });
    }
  };

  const updateThreadTweet = (userId: string, index: number, value: string) => {
    const currentThread = tweetTexts[userId] || [''];
    const newThread = [...currentThread];
    newThread[index] = value;
    setTweetTexts({ ...tweetTexts, [userId]: newThread });
  };

  const handleMediaUpload = async (userId: string, files: FileList | null) => {
    if (!files || files.length === 0) return;

    const fileArray = Array.from(files);
    const validFiles = fileArray.filter(file => {
      const validTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'video/mp4'];
      const maxSize = 10 * 1024 * 1024;
      return validTypes.includes(file.type) && file.size <= maxSize;
    });

    if (validFiles.length === 0) {
      setMessages({ ...messages, [userId]: 'Please select valid media files (images/video, max 10MB)' });
      return;
    }

    if ((mediaFiles[userId]?.length || 0) + validFiles.length > 4) {
      setMessages({ ...messages, [userId]: 'Maximum 4 media files allowed per tweet' });
      return;
    }

    setUploading({ ...uploading, [userId]: true });

    try {
      const uploadedUrls: string[] = [];

      for (const file of validFiles) {
        const fileName = `${Date.now()}-${file.name}`;
        const { data, error } = await supabase.storage
          .from('tweet-media')
          .upload(fileName, file);

        if (error) throw error;

        const { data: urlData } = supabase.storage
          .from('tweet-media')
          .getPublicUrl(fileName);

        uploadedUrls.push(urlData.publicUrl);
      }

      setMediaFiles({
        ...mediaFiles,
        [userId]: [...(mediaFiles[userId] || []), ...validFiles],
      });
      setMediaUrls({
        ...mediaUrls,
        [userId]: [...(mediaUrls[userId] || []), ...uploadedUrls],
      });
      setMessages({ ...messages, [userId]: '' });
    } catch (error) {
      setMessages({
        ...messages,
        [userId]: `Error uploading media: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
    } finally {
      setUploading({ ...uploading, [userId]: false });
    }
  };

  const removeMedia = (userId: string, index: number) => {
    const newFiles = [...(mediaFiles[userId] || [])];
    const newUrls = [...(mediaUrls[userId] || [])];
    newFiles.splice(index, 1);
    newUrls.splice(index, 1);
    setMediaFiles({ ...mediaFiles, [userId]: newFiles });
    setMediaUrls({ ...mediaUrls, [userId]: newUrls });
  };

  const handlePostTweet = async (user: AuthorizedUser) => {
    const tweetThread = tweetTexts[user.id] || [''];
    const filteredThread = tweetThread.filter(t => t.trim());

    if (filteredThread.length === 0) {
      setMessages({ ...messages, [user.id]: 'Please enter tweet text' });
      return;
    }

    setLoading({ ...loading, [user.id]: true });
    setMessages({ ...messages, [user.id]: '' });

    try {
      const apiUrl = `${config.supabaseUrl}/functions/v1/post-tweet`;
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.supabaseAnonKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userId: user.id,
          tweets: filteredThread,
          mediaUrls: mediaUrls[user.id] || [],
        }),
      });

      const result = await response.json();

      if (response.ok) {
        const count = filteredThread.length;
        setMessages({
          ...messages,
          [user.id]: count > 1
            ? `Thread with ${count} tweets posted successfully!`
            : `Tweet posted successfully! ID: ${result.data[0].id}`,
        });
        setTweetTexts({ ...tweetTexts, [user.id]: [''] });
        setMediaFiles({ ...mediaFiles, [user.id]: [] });
        setMediaUrls({ ...mediaUrls, [user.id]: [] });
      } else {
        setMessages({
          ...messages,
          [user.id]: `Error: ${result.error || 'Failed to post tweet'}`,
        });
      }
    } catch (error) {
      setMessages({
        ...messages,
        [user.id]: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
    } finally {
      setLoading({ ...loading, [user.id]: false });
    }
  };

  const handleDeleteUser = async (userId: string) => {
    if (!confirm('Are you sure you want to remove this authorized user?')) {
      return;
    }

    const { error } = await supabase
      .from('authorized_users')
      .delete()
      .eq('id', userId);

    if (error) {
      alert('Error deleting user: ' + error.message);
    } else {
      loadUsers();
    }
  };

  const handleDeleteTweet = async (user: AuthorizedUser) => {
    const tweetId = deleteTweetId[user.id];
    if (!tweetId || !tweetId.trim()) {
      setMessages({ ...messages, [user.id]: 'Please enter a tweet ID' });
      return;
    }

    if (!confirm('Are you sure you want to delete this tweet?')) {
      return;
    }

    setDeleting({ ...deleting, [user.id]: true });
    setMessages({ ...messages, [user.id]: '' });

    try {
      const apiUrl = `${config.supabaseUrl}/functions/v1/delete-tweet`;
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.supabaseAnonKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userId: user.id,
          tweetId: tweetId,
        }),
      });

      const result = await response.json();

      if (response.ok) {
        setMessages({
          ...messages,
          [user.id]: 'Tweet deleted successfully!',
        });
        setDeleteTweetId({ ...deleteTweetId, [user.id]: '' });
      } else {
        setMessages({
          ...messages,
          [user.id]: `Error: ${result.error || 'Failed to delete tweet'}`,
        });
      }
    } catch (error) {
      setMessages({
        ...messages,
        [user.id]: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
    } finally {
      setDeleting({ ...deleting, [user.id]: false });
    }
  };

  return (
    <div className="min-h-screen bg-black">
      <div className="container mx-auto px-4 py-12">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <a href="/" className="inline-block group">
              <h1 className="text-5xl font-bold text-white mb-4 tracking-tight group-hover:text-slate-300 transition">
                [HOME]
              </h1>
            </a>
          </div>

          <div className="mb-12">
            <h2 className="text-3xl font-bold text-white mb-2 tracking-tight">
              User Dashboard
            </h2>
            <p className="text-lg text-slate-400">
              Manage authorized users and post tweets
            </p>
          </div>

          {users.length === 0 ? (
            <div className="bg-zinc-950/80 backdrop-blur-xl border border-zinc-800 rounded-2xl shadow-2xl p-12 text-center">
              <Users className="w-16 h-16 text-zinc-700 mx-auto mb-4" />
              <h2 className="text-2xl font-semibold text-white mb-2">
                No Authorized Users Yet
              </h2>
              <p className="text-slate-400 mb-6">
                Generate an authorization link and share it with users to get
                started
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              {users.map((user) => (
                <div
                  key={user.id}
                  className="bg-zinc-950/80 backdrop-blur-xl border border-zinc-800 rounded-2xl shadow-2xl p-6"
                >
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <h3 className="text-xl font-semibold text-white mb-1">
                        @{user.username}
                      </h3>
                      <p className="text-sm text-slate-400">
                        User ID: {user.id}
                      </p>
                      <p className="text-sm text-slate-400">
                        Authorized:{' '}
                        {new Date(user.created_at).toLocaleDateString()}
                      </p>
                    </div>
                    <button
                      onClick={() => handleDeleteUser(user.id)}
                      className="flex items-center gap-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 font-medium py-2 px-4 rounded-xl transition duration-200"
                    >
                      <Trash2 className="w-4 h-4" />
                      Remove
                    </button>
                  </div>

                  <div className="border-t border-zinc-800 pt-4">
                    <div className="flex items-center justify-between mb-2">
                      <label className="block text-sm font-medium text-slate-300">
                        {(tweetTexts[user.id] || ['']).length > 1 ? 'Thread' : 'Tweet'}
                      </label>
                      <button
                        onClick={() => addTweetToThread(user.id)}
                        className="flex items-center gap-1 text-sm text-blue-400 hover:text-blue-300 transition"
                      >
                        <Plus className="w-4 h-4" />
                        Add to thread
                      </button>
                    </div>

                    <div className="space-y-3">
                      {(tweetTexts[user.id] || ['']).map((tweet, index) => (
                        <div key={index} className="relative">
                          {(tweetTexts[user.id] || ['']).length > 1 && (
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-xs text-slate-500">Tweet {index + 1}</span>
                              {(tweetTexts[user.id] || ['']).length > 1 && (
                                <button
                                  onClick={() => removeTweetFromThread(user.id, index)}
                                  className="text-red-400 hover:text-red-300 transition"
                                >
                                  <X className="w-4 h-4" />
                                </button>
                              )}
                            </div>
                          )}
                          <textarea
                            value={tweet}
                            onChange={(e) => updateThreadTweet(user.id, index, e.target.value)}
                            placeholder={index === 0 ? "What's happening?" : "Continue your thread..."}
                            maxLength={280}
                            rows={3}
                            className="w-full px-4 py-3 bg-black border border-zinc-800 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition resize-none text-white placeholder-zinc-600"
                          />
                          <div className="text-right mt-1">
                            <span className="text-xs text-slate-500">
                              {tweet.length} / 280
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="mt-4">
                      <label className="block text-sm font-medium text-slate-300 mb-2">
                        Media (max 4 images/videos)
                      </label>
                      <div className="flex items-start gap-3">
                        <label className="flex items-center gap-2 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-slate-300 font-medium py-2 px-4 rounded-xl transition duration-200 cursor-pointer">
                          <Image className="w-4 h-4" />
                          {uploading[user.id] ? 'Uploading...' : 'Add Media'}
                          <input
                            type="file"
                            accept="image/jpeg,image/png,image/gif,image/webp,video/mp4"
                            multiple
                            disabled={uploading[user.id] || (mediaFiles[user.id]?.length || 0) >= 4}
                            onChange={(e) => handleMediaUpload(user.id, e.target.files)}
                            className="hidden"
                          />
                        </label>
                        {mediaFiles[user.id] && mediaFiles[user.id].length > 0 && (
                          <div className="flex-1 flex flex-wrap gap-2">
                            {mediaFiles[user.id].map((file, index) => (
                              <div key={index} className="relative group">
                                <div className="w-20 h-20 rounded-lg overflow-hidden border border-zinc-700 bg-zinc-900">
                                  {file.type.startsWith('image/') ? (
                                    <img
                                      src={URL.createObjectURL(file)}
                                      alt={`Media ${index + 1}`}
                                      className="w-full h-full object-cover"
                                    />
                                  ) : (
                                    <video
                                      src={URL.createObjectURL(file)}
                                      className="w-full h-full object-cover"
                                    />
                                  )}
                                </div>
                                <button
                                  onClick={() => removeMedia(user.id, index)}
                                  className="absolute -top-2 -right-2 bg-red-500 hover:bg-red-600 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition"
                                >
                                  <X className="w-3 h-3" />
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center justify-end mt-4">
                      <button
                        onClick={() => handlePostTweet(user)}
                        disabled={loading[user.id]}
                        className="flex items-center gap-2 bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 disabled:from-blue-400 disabled:to-blue-400 text-white font-semibold py-2 px-6 rounded-xl transition duration-200 shadow-lg shadow-blue-500/20"
                      >
                        <Send className="w-4 h-4" />
                        {loading[user.id] ? 'Posting...' : (tweetTexts[user.id] || ['']).length > 1 ? 'Post Thread' : 'Post Tweet'}
                      </button>
                    </div>

                    {messages[user.id] && (
                      <div
                        className={`mt-4 p-4 rounded-xl backdrop-blur-xl ${
                          messages[user.id].includes('Error')
                            ? 'bg-red-500/10 text-red-400 border border-red-500/30'
                            : 'bg-green-500/10 text-green-400 border border-green-500/30'
                        }`}
                      >
                        {messages[user.id]}
                      </div>
                    )}

                    <div className="mt-6 pt-6 border-t border-zinc-800">
                      <label className="block text-sm font-medium text-slate-300 mb-2">
                        Delete Tweet
                      </label>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={deleteTweetId[user.id] || ''}
                          onChange={(e) =>
                            setDeleteTweetId({ ...deleteTweetId, [user.id]: e.target.value })
                          }
                          placeholder="Enter tweet ID to delete"
                          className="flex-1 px-4 py-2 bg-black border border-zinc-800 rounded-xl focus:ring-2 focus:ring-red-500 focus:border-red-500 outline-none transition text-white placeholder-zinc-600"
                        />
                        <button
                          onClick={() => handleDeleteTweet(user)}
                          disabled={deleting[user.id]}
                          className="flex items-center gap-2 bg-red-500/10 hover:bg-red-500/20 disabled:bg-red-500/5 text-red-400 border border-red-500/30 font-medium py-2 px-6 rounded-xl transition duration-200"
                        >
                          <Trash2 className="w-4 h-4" />
                          {deleting[user.id] ? 'Deleting...' : 'Delete'}
                        </button>
                      </div>
                      <p className="text-xs text-slate-500 mt-2">
                        Tip: Copy the tweet ID from the tweet URL or from the success message after posting
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
