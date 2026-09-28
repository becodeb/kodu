import sys,glob
from PIL import Image, ImageDraw
fs=sorted(glob.glob(sys.argv[1]+'/*.png')); cols=int(sys.argv[3]) if len(sys.argv)>3 else 4
w,h=640,360
rows=(len(fs)+cols-1)//cols
S=Image.new('RGB',(cols*w,rows*(h+20)),(60,60,60)); d=ImageDraw.Draw(S)
for i,f in enumerate(fs):
    im=Image.open(f).convert('RGB').resize((w,h)); x=(i%cols)*w; y=(i//cols)*(h+20)
    S.paste(im,(x,y+20)); d.text((x+5,y+4),f.split('/')[-1],fill=(255,255,0))
S.save(sys.argv[2])
