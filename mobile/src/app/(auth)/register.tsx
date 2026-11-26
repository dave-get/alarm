import { AuthForm } from '../../components/AuthForm';
import { useAuth } from '../../context/AuthContext';

export default function RegisterScreen() {
  const { signUp } = useAuth();
  return <AuthForm mode="register" onSubmit={signUp} />;
}
