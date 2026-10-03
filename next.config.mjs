/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // Permite que o servidor de dev seja acessado de qualquer dispositivo na rede local.
  // Necessário para testar pelo celular E para o HMR funcionar quando você acessa pelo IP.
  allowedDevOrigins: [
    // Faixas de IP residencial/corporativo comuns
    '192.168.0.*',
    '192.168.1.*',
    '192.168.2.*',
    '10.0.0.*',
    '10.0.1.*',
    // Adaptadores virtuais do Windows (WSL, Hyper-V, Docker)
    '172.16.*',
    '172.17.*',
    '172.18.*',
    '172.19.*',
    '172.20.*',
    '172.21.*',
    '172.22.*',
    '172.27.*',
    '172.28.*',
    '172.29.*',
    '172.30.*',
    '172.31.*',
  ],
}

export default nextConfig
