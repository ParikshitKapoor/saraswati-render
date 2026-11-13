import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Lock,
  Eye,
  EyeOff,
  KeyRound,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  ArrowLeft,
  RefreshCw,
  CheckCircle2,
  Sparkles,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import api from '../lib/api';
import toast from 'react-hot-toast';

export default function AdminLogin() {
  const [mode, setMode] = useState('login'); // 'login' | 'forgot'
  const [loginForm, setLoginForm] = useState({ username: 'admin', password: '' });
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);

  // 2-Step Password Setup / Recovery Flow: 'REQUEST_OTP' (Step 1) -> 'RESET_PASSWORD' (Step 2) -> 'SUCCESS'
  const [forgotStep, setForgotStep] = useState('REQUEST_OTP');
  const [phoneNumber, setPhoneNumber] = useState('+91 9811798761');
  const [maskedPhone, setMaskedPhone] = useState('+91 98117 •••61');
  const [otpDigits, setOtpDigits] = useState(['', '', '', '', '', '']);
  const [countdown, setCountdown] = useState(0);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPw, setShowNewPw] = useState(false);

  const otpInputsRef = useRef([]);
  const { login } = useAuth();
  const navigate = useNavigate();

  // Load registered admin phone info on mount
  useEffect(() => {
    api.get('/auth/info')
      .then(res => {
        if (res.data?.phone) {
          setPhoneNumber(res.data.phone);
        }
        if (res.data?.maskedPhone) {
          setMaskedPhone(res.data.maskedPhone);
        }
      })
      .catch(() => {});
  }, []);

  // 60-second resend countdown timer
  useEffect(() => {
    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(c => c - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [countdown]);

  // Handle standard Admin Login
  const handleLoginSubmit = async e => {
    e.preventDefault();
    setLoading(true);
    try {
      const { data } = await api.post('/auth/login', loginForm);
      login(data.token, { username: data.username });
      toast.success('Welcome back, Admin!');
      navigate('/admin');
    } catch (err) {
      if (err.response?.data?.needsSetup) {
        toast.error(err.response.data.message, { duration: 6000 });
        setMode('forgot');
        setForgotStep('REQUEST_OTP');
        return;
      }
      toast.error(err.response?.data?.message || 'Invalid credentials');
    } finally {
      setLoading(false);
    }
  };

  // STEP 1: Request OTP (POST /api/auth/request-otp)
  const handleRequestOtp = async (e) => {
    if (e?.preventDefault) e.preventDefault();
    if (!phoneNumber.trim()) {
      toast.error('Please enter a registered phone number');
      return;
    }

    setLoading(true);
    try {
      const { data } = await api.post('/auth/request-otp', {
        phone_number: phoneNumber.trim(),
      });

      if (data.maskedPhone) setMaskedPhone(data.maskedPhone);

      toast.success(data.message || 'OTP dispatched to registered mobile!');
      setForgotStep('RESET_PASSWORD');
      setCountdown(60);
      // Focus first OTP field
      setTimeout(() => otpInputsRef.current[0]?.focus(), 150);
    } catch (err) {
      const status = err.response?.status;
      const msg = err.response?.data?.message;
      if (status === 429) {
        toast.error(msg || 'Please wait before requesting another OTP');
      } else {
        toast.error(msg || 'Failed to dispatch OTP. Please verify phone number and gateway.');
      }
    } finally {
      setLoading(false);
    }
  };

  // OTP segment input handling
  const handleOtpChange = (index, value) => {
    if (!/^\d*$/.test(value)) return;
    const newOtp = [...otpDigits];
    newOtp[index] = value.slice(-1);
    setOtpDigits(newOtp);

    // Auto-advance
    if (value && index < 5) {
      otpInputsRef.current[index + 1]?.focus();
    }
  };

  const handleOtpKeyDown = (index, e) => {
    if (e.key === 'Backspace' && !otpDigits[index] && index > 0) {
      otpInputsRef.current[index - 1]?.focus();
    }
  };

  const handleOtpPaste = e => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').trim().replace(/\D/g, '').slice(0, 6);
    if (!pasted) return;
    const newOtp = [...otpDigits];
    for (let i = 0; i < 6; i++) {
      newOtp[i] = pasted[i] || '';
    }
    setOtpDigits(newOtp);
    const nextIdx = Math.min(pasted.length, 5);
    otpInputsRef.current[nextIdx]?.focus();
  };

  const fullOtp = otpDigits.join('');

  // STEP 2: Set / Reset Password (POST /api/auth/reset-password)
  const handleResetPassword = async e => {
    e.preventDefault();

    if (fullOtp.length !== 6) {
      toast.error('Please enter all 6 digits of the OTP code');
      return;
    }

    if (newPassword.length < 6) {
      toast.error('Password must be at least 6 characters');
      return;
    }

    if (newPassword !== confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }

    setLoading(true);
    try {
      const { data } = await api.post('/auth/reset-password', {
        phone_number: phoneNumber.trim(),
        otp: fullOtp,
        new_password: newPassword,
      });

      toast.success(data.message || 'Password saved successfully!');
      setForgotStep('SUCCESS');
      // Pre-fill login password with the newly set password
      setLoginForm(prev => ({ ...prev, password: newPassword }));
    } catch (err) {
      const msg = err.response?.data?.message || 'Failed to save password';
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  // Calculate password strength
  const getPasswordStrength = pw => {
    if (!pw) return { score: 0, label: '', color: 'bg-slate-700' };
    let score = 0;
    if (pw.length >= 6) score++;
    if (pw.length >= 10) score++;
    if (/[0-9]/.test(pw)) score++;
    if (/[^A-Za-z0-9]/.test(pw)) score++;

    if (score <= 1) return { score: 1, label: 'Weak', color: 'bg-rose-500' };
    if (score <= 2) return { score: 2, label: 'Fair', color: 'bg-amber-500' };
    if (score <= 3) return { score: 3, label: 'Good', color: 'bg-blue-500' };
    return { score: 4, label: 'Strong', color: 'bg-emerald-500' };
  };

  const pwStrength = getPasswordStrength(newPassword);

  return (
    <div className="min-h-screen bg-[#090A0F] text-[#E3E1E9] flex items-center justify-center px-4 py-12 relative overflow-hidden selection:bg-[#F97316] selection:text-black">
      {/* Dynamic Background Cockpit Glows */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[520px] h-[520px] bg-[#F97316]/10 rounded-full blur-[140px] pointer-events-none" />
      <div className="absolute bottom-10 right-10 w-[350px] h-[350px] bg-[#38BDF8]/10 rounded-full blur-[120px] pointer-events-none" />

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
        className="w-full max-w-md relative z-10"
      >
        {/* Brand Header */}
        <div className="text-center mb-7">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[#181B26] border border-white/10 text-xs font-mono uppercase tracking-widest text-[#F97316] mb-3">
            <span className="w-2 h-2 rounded-full bg-[#F97316] animate-ping" />
            Saraswati Motors Ateliers
          </div>

          <h1
            className="text-3xl sm:text-4xl font-extrabold tracking-tight text-white mb-2"
            style={{ fontFamily: 'Space Grotesk, Outfit, sans-serif' }}
          >
            {mode === 'login' ? 'Admin Gateway' : 'Security Setup & Recovery'}
          </h1>
          <p className="text-[#94A3B8] text-sm">
            {mode === 'login'
              ? 'Authorized Superbike Administration & Telemetry'
              : 'Traccar SMS OTP verification protocol'}
          </p>
        </div>

        {/* Card Container */}
        <div className="bg-[#12141C]/90 backdrop-blur-xl border border-white/10 rounded-2xl p-7 sm:p-8 shadow-2xl relative overflow-hidden">
          {/* Top Amber Chamfer Accent */}
          <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-[#F97316] to-transparent" />

          {/* Mode Switcher Tabs */}
          <div className="flex bg-[#090A0F] rounded-xl p-1 mb-6 border border-white/5">
            <button
              type="button"
              onClick={() => {
                setMode('login');
                setForgotStep('REQUEST_OTP');
              }}
              className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all ${
                mode === 'login'
                  ? 'bg-[#F97316] text-[#090A0F] shadow-md shadow-orange-500/20 font-bold'
                  : 'text-[#94A3B8] hover:text-white'
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('forgot');
                if (forgotStep === 'SUCCESS') setForgotStep('REQUEST_OTP');
              }}
              className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all ${
                mode === 'forgot'
                  ? 'bg-[#F97316] text-[#090A0F] shadow-md shadow-orange-500/20 font-bold'
                  : 'text-[#94A3B8] hover:text-white'
              }`}
            >
              Set / Reset Password
            </button>
          </div>

          <AnimatePresence mode="wait">
            {mode === 'login' ? (
              /* ── LOGIN FORM ── */
              <motion.form
                key="login-form"
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 12 }}
                onSubmit={handleLoginSubmit}
                className="space-y-5"
              >
                <div>
                  <label className="text-xs font-mono uppercase tracking-wider text-[#94A3B8] mb-1.5 block">
                    Admin Username
                  </label>
                  <input
                    type="text"
                    required
                    value={loginForm.username}
                    onChange={e => setLoginForm(f => ({ ...f, username: e.target.value }))}
                    placeholder="admin"
                    className="w-full bg-[#181B26] border border-white/10 text-white placeholder-slate-500 px-4 py-3 rounded-xl focus:outline-none focus:border-[#F97316] focus:ring-1 focus:ring-[#F97316] transition-all text-sm font-sans"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-mono uppercase tracking-wider text-[#94A3B8] block">
                      Admin Password
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        setMode('forgot');
                        setForgotStep('REQUEST_OTP');
                      }}
                      className="text-xs text-[#F97316] hover:text-[#FB923C] transition-colors font-medium underline underline-offset-2"
                    >
                      Forgot password?
                    </button>
                  </div>

                  <div className="relative">
                    <input
                      type={showPw ? 'text' : 'password'}
                      required
                      value={loginForm.password}
                      onChange={e => setLoginForm(f => ({ ...f, password: e.target.value }))}
                      placeholder="••••••••"
                      className="w-full bg-[#181B26] border border-white/10 text-white placeholder-slate-500 px-4 py-3 pr-12 rounded-xl focus:outline-none focus:border-[#F97316] focus:ring-1 focus:ring-[#F97316] transition-all text-sm font-sans"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPw(!showPw)}
                      className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white transition-colors"
                      aria-label="Toggle password visibility"
                    >
                      {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full flex items-center justify-center gap-2 bg-[#F97316] hover:bg-[#EA6C10] disabled:opacity-50 text-[#090A0F] font-extrabold py-3.5 rounded-xl transition-all shadow-lg shadow-orange-500/25 hover:shadow-orange-500/40 text-sm cursor-pointer"
                >
                  {loading ? (
                    <div className="w-5 h-5 border-2 border-[#090A0F] border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <>
                      <Lock size={16} />
                      Authenticate to Dashboard
                    </>
                  )}
                </button>

                {/* First-time Setup Link */}
                <div className="pt-2 text-center">
                  <button
                    type="button"
                    onClick={() => {
                      setMode('forgot');
                      setForgotStep('REQUEST_OTP');
                    }}
                    className="text-xs text-[#94A3B8] hover:text-[#F97316] transition-colors inline-flex items-center gap-1 font-mono"
                  >
                    First time logging in? <span className="underline text-[#F97316]">Set password via OTP</span>
                  </button>
                </div>
              </motion.form>
            ) : (
              /* ── 2-STEP PASSWORD SETUP & RECOVERY FLOW ── */
              <motion.div
                key="forgot-password-flow"
                initial={{ opacity: 0, x: 12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -12 }}
                className="space-y-5"
              >
                {/* STEP 1: VERIFIED OWNER MOBILE + SEND OTP BUTTON */}
                {forgotStep === 'REQUEST_OTP' && (
                  <div className="space-y-5">
                    <div className="text-center">
                      <div className="w-14 h-14 rounded-2xl bg-[#F97316]/10 border border-[#F97316]/30 flex items-center justify-center mx-auto text-[#F97316] mb-3">
                        <Smartphone size={26} />
                      </div>

                      <h3
                        className="text-lg font-bold text-white mb-1"
                        style={{ fontFamily: 'Space Grotesk, sans-serif' }}
                      >
                        Set / Reset via Owner OTP
                      </h3>
                      <p className="text-xs text-[#94A3B8] leading-relaxed">
                        A single-use 6-digit OTP will be dispatched via Traccar Gateway to the showroom owner's registered mobile number.
                      </p>
                    </div>

                    {/* Locked Display Card for Registered Owner Phone */}
                    <div className="bg-[#181B26] border border-white/10 rounded-xl p-4 flex items-center justify-between text-left">
                      <div>
                        <div className="text-[10px] font-mono uppercase tracking-wider text-slate-400">
                          Registered Owner Mobile
                        </div>
                        <div className="text-base font-mono font-bold text-white tracking-wider mt-0.5">
                          {maskedPhone || '+91 98117 •••61'}
                        </div>
                      </div>
                      <span className="inline-flex items-center gap-1 text-[11px] font-mono px-2.5 py-1 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-medium">
                        <ShieldCheck size={13} /> Verified
                      </span>
                    </div>

                    <button
                      type="button"
                      disabled={loading}
                      onClick={handleRequestOtp}
                      className="w-full flex items-center justify-center gap-2 bg-[#F97316] hover:bg-[#EA6C10] disabled:opacity-50 text-[#090A0F] font-extrabold py-3.5 rounded-xl transition-all shadow-lg shadow-orange-500/25 text-sm cursor-pointer"
                    >
                      {loading ? (
                        <div className="w-5 h-5 border-2 border-[#090A0F] border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <>
                          <KeyRound size={16} />
                          Send Verification OTP
                        </>
                      )}
                    </button>

                    <div className="text-center">
                      <button
                        type="button"
                        onClick={() => setMode('login')}
                        className="inline-flex items-center gap-1.5 text-xs text-[#94A3B8] hover:text-white transition-colors"
                      >
                        <ArrowLeft size={14} /> Back to Sign In
                      </button>
                    </div>
                  </div>
                )}

                {/* STEP 2: 6-DIGIT OTP + NEW PASSWORD + SAVE BUTTON */}
                {forgotStep === 'RESET_PASSWORD' && (
                  <form onSubmit={handleResetPassword} className="space-y-4">
                    <div className="text-center">
                      <div className="w-12 h-12 rounded-xl bg-[#38BDF8]/10 border border-[#38BDF8]/30 flex items-center justify-center mx-auto text-[#38BDF8] mb-2">
                        <KeyRound size={22} />
                      </div>
                      <h3
                        className="text-base font-bold text-white"
                        style={{ fontFamily: 'Space Grotesk, sans-serif' }}
                      >
                        Enter OTP & Choose Password
                      </h3>
                      <div className="flex items-center justify-center gap-2 text-xs text-[#94A3B8] mt-0.5">
                        <span>Code dispatched to <strong className="text-white font-mono">{maskedPhone}</strong></span>
                      </div>
                    </div>

                    {/* Segmented OTP 6-Box Input */}
                    <div>
                      <label className="text-[11px] font-mono uppercase tracking-wider text-[#94A3B8] mb-1.5 block text-center">
                        6-Digit Security Code
                      </label>
                      <div className="flex items-center justify-center gap-2" onPaste={handleOtpPaste}>
                        {otpDigits.map((digit, idx) => (
                          <input
                            key={idx}
                            ref={el => (otpInputsRef.current[idx] = el)}
                            type="text"
                            inputMode="numeric"
                            maxLength={1}
                            value={digit}
                            onChange={e => handleOtpChange(idx, e.target.value)}
                            onKeyDown={e => handleOtpKeyDown(idx, e)}
                            className="w-11 h-13 text-center text-xl font-mono font-bold bg-[#181B26] border border-white/15 focus:border-[#F97316] focus:ring-1 focus:ring-[#F97316] text-white rounded-xl outline-none transition-all shadow-inner"
                          />
                        ))}
                      </div>
                    </div>

                    {/* Resend 60-Second Countdown */}
                    <div className="flex items-center justify-between text-xs font-mono pt-0.5">
                      <span className="text-[#94A3B8]">
                        {countdown > 0 ? `Resend in ${countdown}s` : 'Did not receive code?'}
                      </span>
                      <button
                        type="button"
                        disabled={countdown > 0 || loading}
                        onClick={handleRequestOtp}
                        className="text-[#F97316] hover:text-[#FB923C] disabled:text-slate-600 transition-colors flex items-center gap-1 font-bold"
                      >
                        <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Resend OTP
                      </button>
                    </div>

                    {/* New Password Input */}
                    <div className="pt-2 border-t border-white/10">
                      <label className="text-xs font-mono uppercase tracking-wider text-[#94A3B8] mb-1.5 block">
                        Set Password
                      </label>
                      <div className="relative">
                        <input
                          type={showNewPw ? 'text' : 'password'}
                          required
                          value={newPassword}
                          onChange={e => setNewPassword(e.target.value)}
                          placeholder="At least 6 characters"
                          className="w-full bg-[#181B26] border border-white/10 text-white placeholder-slate-500 px-4 py-2.5 pr-12 rounded-xl focus:outline-none focus:border-[#F97316] text-sm"
                        />
                        <button
                          type="button"
                          onClick={() => setShowNewPw(!showNewPw)}
                          className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                        >
                          {showNewPw ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                      </div>

                      {/* Password strength meter */}
                      {newPassword && (
                        <div className="mt-2 space-y-1">
                          <div className="flex gap-1 h-1.5">
                            {[1, 2, 3, 4].map(step => (
                              <div
                                key={step}
                                className={`flex-1 rounded-full transition-all ${
                                  pwStrength.score >= step ? pwStrength.color : 'bg-slate-800'
                                }`}
                              />
                            ))}
                          </div>
                          <div className="flex justify-between text-[10px] font-mono text-[#94A3B8]">
                            <span>Strength: <strong className="text-white">{pwStrength.label}</strong></span>
                            <span>Min 6 chars</span>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Confirm Password Input */}
                    <div>
                      <label className="text-xs font-mono uppercase tracking-wider text-[#94A3B8] mb-1.5 block">
                        Confirm Password
                      </label>
                      <input
                        type={showNewPw ? 'text' : 'password'}
                        required
                        value={confirmPassword}
                        onChange={e => setConfirmPassword(e.target.value)}
                        placeholder="Re-enter password"
                        className="w-full bg-[#181B26] border border-white/10 text-white placeholder-slate-500 px-4 py-2.5 rounded-xl focus:outline-none focus:border-[#F97316] text-sm"
                      />
                      {confirmPassword && newPassword !== confirmPassword && (
                        <p className="text-xs text-rose-400 flex items-center gap-1 mt-1">
                          <ShieldAlert size={13} /> Passwords do not match
                        </p>
                      )}
                    </div>

                    {/* Save Password Button */}
                    <button
                      type="submit"
                      disabled={loading || fullOtp.length !== 6 || newPassword.length < 6 || newPassword !== confirmPassword}
                      className="w-full flex items-center justify-center gap-2 bg-[#F97316] hover:bg-[#EA6C10] disabled:opacity-50 text-[#090A0F] font-extrabold py-3.5 rounded-xl transition-all shadow-lg shadow-orange-500/25 text-sm cursor-pointer mt-2"
                    >
                      {loading ? (
                        <div className="w-5 h-5 border-2 border-[#090A0F] border-t-transparent rounded-full animate-spin" />
                      ) : (
                        'Save & Activate Password'
                      )}
                    </button>
                  </form>
                )}

                {/* STEP 3: SUCCESS STATE */}
                {forgotStep === 'SUCCESS' && (
                  <div className="space-y-5 text-center py-2">
                    <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center mx-auto text-emerald-400">
                      <CheckCircle2 size={36} />
                    </div>

                    <div>
                      <h3
                        className="text-lg font-bold text-white mb-1"
                        style={{ fontFamily: 'Space Grotesk, sans-serif' }}
                      >
                        Password Activated Successfully!
                      </h3>
                      <p className="text-xs text-[#94A3B8] leading-relaxed">
                        Your admin password has been saved securely. You can now use this password for all future sign-ins.
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        setMode('login');
                        setForgotStep('REQUEST_OTP');
                      }}
                      className="w-full flex items-center justify-center gap-2 bg-[#F97316] hover:bg-[#EA6C10] text-[#090A0F] font-extrabold py-3.5 rounded-xl transition-all shadow-lg shadow-orange-500/25 text-sm cursor-pointer"
                    >
                      <Sparkles size={16} /> Proceed to Sign In
                    </button>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Back to Home Link */}
        <div className="text-center mt-6">
          <a
            href="/"
            className="text-xs font-mono text-[#94A3B8] hover:text-[#F97316] transition-colors inline-flex items-center gap-1.5"
          >
            ← Back to Saraswati Superbikes Showroom
          </a>
        </div>
      </motion.div>
    </div>
  );
}
