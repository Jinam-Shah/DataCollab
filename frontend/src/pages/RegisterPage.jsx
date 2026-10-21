import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import api from '../services/api';
import { saveAuthData } from '../utils/auth';
import AuthLayout, { inputClass, labelClass } from './AuthLayout';

function RegisterPage() {
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [workspaceId, setWorkspaceId] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const response = await api.post('/api/auth/register', {
        username,
        email,
        password,
        workspaceId: workspaceId.trim() || undefined,
        inviteCode: inviteCode.trim() || undefined,
      });
      const { token, user } = response.data;
      saveAuthData(token, user);
      // A new workspace's creator lands on the Team page, where the invite code is.
      navigate(response.data.inviteCode ? '/app/team' : '/app/data');
    } catch (err) {
      setError(err.response?.data?.error || 'Registration failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout title="Create your account" subtitle="Free. Takes a few seconds.">
      {error && (
        <div
          className="bg-red-50 border border-red-200 text-red-800 px-3 py-2 rounded-lg mb-4 text-sm"
          role="alert"
        >
          <div className="font-semibold">Registration Failed</div>
          {error}
        </div>
      )}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="reg-username" className={labelClass}>
            Username
          </label>
          <input
            id="reg-username"
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className={inputClass}
            placeholder="alice"
            required
            minLength={3}
            disabled={loading}
          />
        </div>
        <div>
          <label htmlFor="reg-email" className={labelClass}>
            Email
          </label>
          <input
            id="reg-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputClass}
            placeholder="alice@example.com"
            required
            disabled={loading}
          />
        </div>
        <div>
          <label htmlFor="reg-password" className={labelClass}>
            Password
          </label>
          <input
            id="reg-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputClass}
            placeholder="At least 6 characters"
            required
            minLength={6}
            disabled={loading}
          />
        </div>
        <div>
          <label htmlFor="reg-workspace" className={labelClass}>
            Workspace ID <span className="text-slate-400 font-normal">(optional)</span>
          </label>
          <input
            id="reg-workspace"
            type="text"
            value={workspaceId}
            onChange={(e) => setWorkspaceId(e.target.value)}
            className={inputClass}
            placeholder="e.g. team-alpha"
            disabled={loading}
          />
          <p className="text-xs text-slate-500 mt-1">
            Leave blank for a private workspace. A new name creates that workspace for your team.
          </p>
        </div>
        <div>
          <label htmlFor="reg-invite" className={labelClass}>
            Invite code <span className="text-slate-400 font-normal">(to join a team)</span>
          </label>
          <input
            id="reg-invite"
            type="text"
            value={inviteCode}
            onChange={(e) => setInviteCode(e.target.value)}
            className={inputClass}
            placeholder="From a teammate's Team page"
            autoComplete="off"
            disabled={loading}
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          className="w-full bg-indigo-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:bg-indigo-300"
        >
          {loading ? 'Creating account...' : 'Sign Up'}
        </button>
      </form>
      <p className="text-center text-sm text-slate-600 mt-6">
        Already have an account?{' '}
        <Link to="/login" className="text-indigo-600 hover:underline font-medium">
          Sign in
        </Link>
      </p>
    </AuthLayout>
  );
}

export default RegisterPage;
