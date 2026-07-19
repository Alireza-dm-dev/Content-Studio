const pkg = require("@prisma/client");
const { PrismaClient } = pkg;
const prisma = new PrismaClient();
function classify(jp){
  if(!jp||!jp.trim())return"invalid";
  let p;try{p=JSON.parse(jp);}catch{return"invalid";}
  if(!p||typeof p!=="object")return"invalid";
  const files=Array.isArray(p.files)?p.files:[];
  const hasDoc=files.some(f=>f&&typeof f.document_url==="string");
  const hasImg=files.some(f=>f&&"image_url" in f);
  const hasMediaUrl="media_url" in p&&!!p.media_url;
  let kind="other";
  if(hasDoc&&!hasImg)kind="canonical";else if(hasImg)kind="legacy";
  return{kind,hasMediaUrl};
}
(async()=>{
  const posts=await prisma.publishedPost.findMany({where:{platform:"LinkedIn"},select:{id:true,jsonPayload:true}});
  const c={total:posts.length,canonical:0,legacy:0,withMediaUrl:0,invalid:0,other:0};
  for(const p of posts){const r=classify(p.jsonPayload);if(r==="invalid"){c.invalid++;}else{if(r.kind==="canonical")c.canonical++;else if(r.kind==="legacy")c.legacy++;else c.other++;if(r.hasMediaUrl)c.withMediaUrl++;}}
  console.log(JSON.stringify(c,null,2));
})().catch(e=>{console.error("AUDIT_FAILED:",e.message);process.exit(1);}).finally(()=>prisma.$disconnect());
