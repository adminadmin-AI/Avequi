import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';

// Placeholder: será substituído pelo PrismaService quando o S01 estiver completo
const DEMO_USERS = [
  {
    id: '1',
    email: 'admin@gdr.com.br',
    password: bcrypt.hashSync('admin123', 10),
    name: 'Administrador',
    role: 'SUPER_ADMIN',
    companyId: 'gdr-matriz',
  },
];

@Injectable()
export class AuthService {
  constructor(private readonly jwtService: JwtService) {}

  async validateUser(email: string, password: string) {
    const user = DEMO_USERS.find((u) => u.email === email);
    if (!user) return null;
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return null;
    const { password: _pw, ...result } = user;
    return result;
  }

  async login(user: any) {
    const payload = { sub: user.id, email: user.email, role: user.role, companyId: user.companyId };
    return {
      accessToken: this.jwtService.sign(payload),
      refreshToken: this.jwtService.sign(payload, {
        secret: process.env.JWT_REFRESH_SECRET,
        expiresIn: process.env.JWT_REFRESH_EXPIRY ?? '7d',
      }),
      user,
    };
  }

  async refresh(refreshToken: string) {
    try {
      const payload = this.jwtService.verify(refreshToken, {
        secret: process.env.JWT_REFRESH_SECRET,
      });
      const { iat, exp, ...rest } = payload;
      return {
        accessToken: this.jwtService.sign(rest),
      };
    } catch {
      throw new UnauthorizedException('Refresh token inválido ou expirado');
    }
  }

  async logout(_refreshToken: string) {
    // TODO S01: invalidar token no Redis (blacklist)
  }
}
