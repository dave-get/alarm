import { AuthForm } from '../../components/AuthForm';
import { useAuth } from '../../context/AuthContext';

export default function LoginScreen() {
  const { signIn } = useAuth();
  return <AuthForm mode="login" onSubmit={signIn} />;
}
