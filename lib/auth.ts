import "dotenv/config";
import { betterAuth } from 'better-auth'
import { prismaAdapter } from 'better-auth/adapters/prisma'
import { prisma } from './prisma'
import crypto from 'crypto'
import { sendEmail } from './sendEmail'

export const auth = betterAuth({
    database: prismaAdapter(prisma,{
        provider: "mongodb" 
        
    }),

    trustedOrigins:["https://square-trade-frontend.vercel.app"],
    
    advanced:{
        database:{
            generateId: ()=>{
                return crypto.randomBytes(12).toString("hex")
            }
        },
        useSecureCookies: true,
        defaultCookieAttributes: {
        sameSite: "lax",
        secure: true,
        },
        
    },


    account:{
        accountLinking:{
            enabled: true
        }
    },

    emailAndPassword:{
        enabled: true,
        autoSignIn: true,
        requireEmailVerification: true,
        revokeSessionsOnPasswordReset: true,
        sendResetPassword: async ({ user, url }) => {
            void sendEmail({ to: user.email, subject: "Reset your password", message: `Reset your password using this link: ${url}` }).catch(error => console.error(`Password reset email failed: ${error}`));
        }
    },

    baseURL: process.env.BETTER_AUTH_URL as string,
    
    socialProviders: { 
        google: { 
        clientId: process.env.GOOGLE_CLIENT_ID as string, 
        clientSecret: process.env.GOOGLE_CLIENT_SECRET as string, 
        }, 
  }, 
  
  emailVerification: {
    sendVerificationEmail: async ( { user, url, token }, request) => {
      void sendEmail({
        to: user.email,
        subject: "Verify your email address",
        message: `Click the link to verify your email: ${url}`,
      }).catch(error => console.error(`Verification email failed: ${error}`));
    },
  },

  user:{
    additionalFields:{
        role:{
            type: "string",
            required:false
             
        }
    }
  }
})